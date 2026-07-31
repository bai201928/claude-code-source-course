from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from contextlib import suppress
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from types import MappingProxyType
from typing import Literal, Protocol, TypeAlias

from compact import (
    CompactCommitSummary,
    CompactCoordinator,
    CompactJournal,
    ConversationSummarizer,
)

from conversation_store import (
    ActiveRunError,
    AssistantMessage,
    ConversationSnapshot,
    ConversationStore,
    ConversationRunLease,
    DurableMessage,
    HumanMessage,
    MessageInvariantError,
    SystemMessage,
    ToolResultMessage,
    ToolUseBlock,
    envelope_id,
    response_id,
    text_block,
    tool_use_block,
    tool_use_id,
)

Scalar: TypeAlias = str | int | float | bool | None
ToolRisk: TypeAlias = Literal["read", "execute"]
RunStatus: TypeAlias = Literal["completed", "cancelled", "failed", "max-turns"]


class OperationCancelled(RuntimeError):
    pass


class ToolExecutionError(RuntimeError):
    pass


class CancellationSignal:
    """A cooperative cancellation signal that carries a stable reason."""

    def __init__(self) -> None:
        self._event = asyncio.Event()
        self._reason: str | None = None

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    @property
    def reason(self) -> str | None:
        return self._reason

    def cancel(self, reason: str = "operation cancelled") -> None:
        if self._event.is_set():
            return
        self._reason = reason.strip() or "operation cancelled"
        self._event.set()

    def throw_if_cancelled(self) -> None:
        if self.cancelled:
            raise OperationCancelled(self._reason or "operation cancelled")

    async def wait(self) -> str:
        await self._event.wait()
        return self._reason or "operation cancelled"


@dataclass(frozen=True)
class ModelToolCall:
    id: str
    name: str
    input: Mapping[str, object]


@dataclass(frozen=True)
class ModelToolDefinition:
    name: str
    description: str
    input_schema: Mapping[str, object]


@dataclass(frozen=True)
class ModelMessage:
    role: Literal["system", "user", "assistant", "tool"]
    content: str | None
    tool_calls: tuple[ModelToolCall, ...] = ()
    tool_call_id: str | None = None


@dataclass(frozen=True)
class ModelRequest:
    request_id: str
    model: str
    messages: tuple[ModelMessage, ...]
    tools: tuple[ModelToolDefinition, ...]


@dataclass(frozen=True)
class RequestProjectionPolicy:
    history_start: int = 0
    user_context: str = ""
    max_tool_result_chars: int | None = None
    max_tool_result_group_chars: int | None = None
    tool_result_preview_chars: int = 96


@dataclass(frozen=True)
class RequestProjectionReport:
    source_count: int
    selected_count: int
    projected_count: int
    omitted_before_history_start: int
    replaced_tool_result_count: int
    newly_replaced_tool_result_count: int
    reapplied_tool_result_count: int
    frozen_tool_result_count: int
    aggregate_budget_group_count: int
    over_budget_tool_result_group_count: int
    replacement_revision: int
    user_context_injected: bool
    strict_validation: Literal["passed"] = "passed"


class RequestProjectionError(ValueError):
    pass


class StaleReplacementRevisionError(RuntimeError):
    pass


@dataclass(frozen=True)
class ResultBudgetLedgerSnapshot:
    revision: int
    seen_ids: frozenset[str]
    replacements: tuple[tuple[str, str], ...]

    def replacement_map(self) -> dict[str, str]:
        return dict(self.replacements)


@dataclass(frozen=True)
class ResultBudgetLedgerChange:
    expected_revision: int
    seen_ids: frozenset[str]
    replacements: tuple[tuple[str, str], ...]


class ResultBudgetLedger:
    def __init__(self) -> None:
        self._revision = 0
        self._seen_ids: set[str] = set()
        self._replacements: dict[str, str] = {}

    def snapshot(self) -> ResultBudgetLedgerSnapshot:
        return ResultBudgetLedgerSnapshot(
            self._revision,
            frozenset(self._seen_ids),
            tuple(sorted(self._replacements.items())),
        )

    def commit(self, change: ResultBudgetLedgerChange) -> int:
        if change.expected_revision != self._revision:
            raise StaleReplacementRevisionError(
                f"replacement revision {change.expected_revision} is stale; "
                f"current={self._revision}"
            )
        old_seen = len(self._seen_ids)
        old_replacements = dict(self._replacements)
        self._seen_ids.update(change.seen_ids)
        self._replacements.update(dict(change.replacements))
        if len(self._seen_ids) != old_seen or self._replacements != old_replacements:
            self._revision += 1
        return self._revision


@dataclass(frozen=True)
class _AggregateProjection:
    messages: tuple[ModelMessage, ...]
    newly_replaced_count: int
    reapplied_count: int
    frozen_count: int
    group_count: int
    over_budget_group_count: int
    change: ResultBudgetLedgerChange


@dataclass(frozen=True)
class ModelUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int | None = None


@dataclass(frozen=True)
class ModelResponse:
    response_id: str
    text: str | None = None
    tool_calls: tuple[ModelToolCall, ...] = ()
    usage: ModelUsage | None = None


class ModelAdapter(Protocol):
    provider: str
    model: str

    async def complete(
        self, request: ModelRequest, signal: CancellationSignal
    ) -> ModelResponse: ...


ModelScript: TypeAlias = Callable[
    [ModelRequest, int, CancellationSignal],
    ModelResponse | Awaitable[ModelResponse],
]


class ScriptedModel:
    """Deterministic provider-neutral model used by tests and local demos."""

    provider = "scripted"

    def __init__(
        self,
        scripts: Sequence[ModelScript],
        model: str = "scripted-model",
    ) -> None:
        _require_non_empty(model, "model")
        self.model = model
        self._scripts = tuple(scripts)
        self.requests: list[ModelRequest] = []

    async def complete(
        self, request: ModelRequest, signal: CancellationSignal
    ) -> ModelResponse:
        signal.throw_if_cancelled()
        request_copy = _copy_request(request)
        self.requests.append(request_copy)
        index = len(self.requests) - 1
        if index >= len(self._scripts):
            raise RuntimeError("unexpected model request")
        produced = self._scripts[index](request_copy, index, signal)
        response = await produced if inspect.isawaitable(produced) else produced
        if not isinstance(response, ModelResponse):
            raise TypeError("model script must return ModelResponse")
        return _copy_response(response)


@dataclass(frozen=True)
class PermissionRequest:
    tool_name: str
    risk: ToolRisk
    command: str | None = None


@dataclass(frozen=True)
class PermissionDecision:
    allowed: bool
    reason: str


class PermissionDeniedError(RuntimeError):
    def __init__(self, decision: PermissionDecision) -> None:
        super().__init__(decision.reason)
        self.decision = decision


class PermissionGate:
    """Reads pass; executable grants permit arbitrary argv and remain high risk."""

    def __init__(self, allowed_commands: Iterable[str] = ()) -> None:
        self._allowed_commands = frozenset(
            command.strip() for command in allowed_commands if command.strip()
        )

    def decide(
        self,
        request: PermissionRequest,
        _signal: CancellationSignal,
    ) -> PermissionDecision:
        if request.risk == "read":
            return PermissionDecision(True, "workspace-read-policy")
        if request.command and request.command in self._allowed_commands:
            return PermissionDecision(True, "explicit-unrestricted-executable-grant")
        reason = (
            f"executable has no unrestricted grant: {request.command}"
            if request.command
            else "execution tool requires an explicit executable identity"
        )
        return PermissionDecision(False, reason)


@dataclass(frozen=True)
class ToolContext:
    signal: CancellationSignal
    report_progress: Callable[[ToolProgress], object | Awaitable[object]] | None = None


@dataclass(frozen=True)
class ToolProgress:
    stage: str
    completed: int | None = None
    total: int | None = None


ToolHandler: TypeAlias = Callable[
    [Mapping[str, object], ToolContext], object | Awaitable[object]
]
PermissionRequestFactory: TypeAlias = Callable[
    [Mapping[str, object]], PermissionRequest
]
ConcurrencyClassifier: TypeAlias = Callable[[Mapping[str, object]], bool]
ContextUpdateFactory: TypeAlias = Callable[
    [Mapping[str, object], object], Mapping[str, object] | None
]


@dataclass(frozen=True)
class AgentTool:
    name: str
    description: str
    input_schema: Mapping[str, object]
    risk: ToolRisk
    execute: ToolHandler
    permission_request: PermissionRequestFactory
    is_concurrency_safe: ConcurrencyClassifier | None = None
    context_update: ContextUpdateFactory | None = None


@dataclass(frozen=True)
class ToolDispatchResult:
    decision: PermissionDecision
    output: object
    context_update: Mapping[str, object] | None = None


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, AgentTool] = {}

    def register(self, tool: AgentTool) -> None:
        _require_identifier(tool.name, "tool name")
        if tool.name in self._tools:
            raise ValueError(f"tool already registered: {tool.name}")
        self._tools[tool.name] = tool

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._tools))

    def definitions(self) -> tuple[ModelToolDefinition, ...]:
        return tuple(
            ModelToolDefinition(
                tool.name,
                tool.description,
                _freeze_mapping(tool.input_schema),
            )
            for tool in (self._tools[name] for name in self.names())
        )

    def is_concurrency_safe(
        self, name: str, tool_input: Mapping[str, object]
    ) -> bool:
        tool = self._tools.get(name)
        if tool is None:
            return False
        try:
            frozen_input = _freeze_mapping(tool_input)
            _validate_tool_input(frozen_input, tool.input_schema)
            return bool(
                tool.is_concurrency_safe is not None
                and tool.is_concurrency_safe(frozen_input)
            )
        except Exception:
            return False

    async def dispatch(
        self,
        name: str,
        tool_input: Mapping[str, object],
        context: ToolContext,
        gate: PermissionGate,
    ) -> ToolDispatchResult:
        tool = self._tools.get(name)
        if tool is None:
            raise ToolExecutionError(f"tool has no executable handler: {name}")
        frozen_input = _freeze_mapping(tool_input)
        _validate_tool_input(frozen_input, tool.input_schema)
        request = tool.permission_request(frozen_input)
        decision = await _resolve_permission_decision(
            gate.decide(request, context.signal),
            context.signal,
        )
        if not decision.allowed:
            raise PermissionDeniedError(decision)
        context.signal.throw_if_cancelled()
        produced = tool.execute(frozen_input, context)
        output = await produced if inspect.isawaitable(produced) else produced
        context.signal.throw_if_cancelled()
        context_update = (
            tool.context_update(frozen_input, output)
            if tool.context_update is not None
            else None
        )
        return ToolDispatchResult(
            decision,
            output,
            _freeze_mapping(context_update) if context_update is not None else None,
        )


@dataclass(frozen=True)
class ToolExecutionBatch:
    mode: Literal["concurrent", "exclusive"]
    calls: tuple[ModelToolCall, ...]


@dataclass(frozen=True)
class ToolExecutionPlan:
    max_concurrency: int
    batches: tuple[ToolExecutionBatch, ...]


@dataclass(frozen=True)
class ToolExecutionOutcome:
    call: ModelToolCall
    status: Literal["success", "error", "denied", "cancelled"]
    output: str
    is_error: bool
    reason: str
    context_update: Mapping[str, object] | None = None


class ToolScheduler:
    def __init__(self, registry: ToolRegistry, max_concurrency: int = 4) -> None:
        if isinstance(max_concurrency, bool) or not isinstance(max_concurrency, int):
            raise ValueError("max tool concurrency must be an integer from 1 to 32")
        if max_concurrency < 1 or max_concurrency > 32:
            raise ValueError("max tool concurrency must be an integer from 1 to 32")
        self._registry = registry
        self._max_concurrency = max_concurrency

    def plan(self, calls: Sequence[ModelToolCall]) -> ToolExecutionPlan:
        batches: list[ToolExecutionBatch] = []
        safe: list[ModelToolCall] = []

        def flush_safe() -> None:
            if safe:
                batches.append(ToolExecutionBatch("concurrent", tuple(safe)))
                safe.clear()

        for call in calls:
            if self._registry.is_concurrency_safe(call.name, call.input):
                safe.append(call)
            else:
                flush_safe()
                batches.append(ToolExecutionBatch("exclusive", (call,)))
        flush_safe()
        return ToolExecutionPlan(self._max_concurrency, tuple(batches))

    async def execute(
        self,
        plan: ToolExecutionPlan,
        *,
        signal: CancellationSignal,
        gate: PermissionGate,
        initial_context: Mapping[str, object] | None = None,
        started: Callable[[ModelToolCall], object | Awaitable[object]] | None = None,
        progress: Callable[
            [ModelToolCall, ToolProgress], object | Awaitable[object]
        ] | None = None,
    ) -> tuple[tuple[ToolExecutionOutcome, ...], Mapping[str, object]]:
        outcomes: dict[str, ToolExecutionOutcome] = {}
        context: dict[str, object] = deepcopy(dict(initial_context or {}))

        for batch in plan.batches:
            if batch.mode == "exclusive":
                completed = (
                    await self._execute_one(
                        batch.calls[0], signal, gate, started, progress
                    ),
                )
            else:
                completed = await self._execute_concurrent(
                    batch.calls,
                    plan.max_concurrency,
                    signal,
                    gate,
                    started,
                    progress,
                )
            outcomes.update((outcome.call.id, outcome) for outcome in completed)
            for call in batch.calls:
                update = outcomes[call.id].context_update
                if update is not None:
                    context.update(deepcopy(dict(update)))

        ordered_calls = tuple(call for batch in plan.batches for call in batch.calls)
        return (
            tuple(outcomes[call.id] for call in ordered_calls),
            MappingProxyType(context),
        )

    async def _execute_concurrent(
        self,
        calls: tuple[ModelToolCall, ...],
        limit: int,
        signal: CancellationSignal,
        gate: PermissionGate,
        started: Callable[[ModelToolCall], object | Awaitable[object]] | None,
        progress: Callable[[ModelToolCall, ToolProgress], object | Awaitable[object]] | None,
    ) -> tuple[ToolExecutionOutcome, ...]:
        outcomes: list[ToolExecutionOutcome | None] = [None] * len(calls)
        next_index = 0
        lock = asyncio.Lock()

        async def worker() -> None:
            nonlocal next_index
            while True:
                async with lock:
                    index = next_index
                    next_index += 1
                if index >= len(calls):
                    return
                outcomes[index] = await self._execute_one(
                    calls[index], signal, gate, started, progress
                )

        await asyncio.gather(
            *(worker() for _ in range(min(limit, len(calls))))
        )
        return tuple(outcome for outcome in outcomes if outcome is not None)

    async def _execute_one(
        self,
        call: ModelToolCall,
        signal: CancellationSignal,
        gate: PermissionGate,
        started: Callable[[ModelToolCall], object | Awaitable[object]] | None,
        progress: Callable[[ModelToolCall, ToolProgress], object | Awaitable[object]] | None,
    ) -> ToolExecutionOutcome:
        if signal.cancelled:
            return _cancelled_tool_outcome(call, "cancelled before execution")
        await _safe_observer(started, call)

        async def report_progress(item: ToolProgress) -> None:
            await _safe_observer(progress, call, item)

        try:
            dispatched = await self._registry.dispatch(
                call.name,
                call.input,
                ToolContext(signal, report_progress),
                gate,
            )
            signal.throw_if_cancelled()
            return ToolExecutionOutcome(
                call,
                "success",
                _serialize_output(dispatched.output),
                False,
                dispatched.decision.reason,
                dispatched.context_update,
            )
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if signal.cancelled or isinstance(error, OperationCancelled):
                return _cancelled_tool_outcome(call, _safe_error(error))
            denied = isinstance(error, PermissionDeniedError)
            return ToolExecutionOutcome(
                call,
                "denied" if denied else "error",
                _safe_error(error),
                True,
                error.decision.reason if denied else "tool-execution",
            )


@dataclass(frozen=True)
class TraceEvent:
    sequence: int
    timestamp: str
    run_id: str
    event_type: str
    attributes: Mapping[str, Scalar]


class TraceRecorder:
    """In-memory metadata trace; content-bearing attribute names are rejected."""

    _CONTENT_KEYS = frozenset(
        {
            "prompt",
            "input",
            "output",
            "content",
            "text",
            "messages",
            "toolinput",
            "tool_input",
        }
    )

    def __init__(self) -> None:
        self._sequence = 0
        self._events: list[TraceEvent] = []
        self._errors: list[str] = []

    @property
    def events(self) -> tuple[TraceEvent, ...]:
        return tuple(self._events)

    @property
    def errors(self) -> tuple[str, ...]:
        return tuple(self._errors)

    def record(
        self,
        run_id: str,
        event_type: str,
        attributes: Mapping[str, Scalar] | None = None,
    ) -> None:
        copied = dict(attributes or {})
        forbidden = self._CONTENT_KEYS.intersection(key.lower() for key in copied)
        if forbidden:
            self._errors.append(
                "rejected content-bearing trace attributes: "
                + ",".join(sorted(forbidden))
            )
            return
        if any(not isinstance(value, (str, int, float, bool, type(None))) for value in copied.values()):
            self._errors.append("rejected non-scalar trace attributes")
            return
        self._sequence += 1
        self._events.append(
            TraceEvent(
                self._sequence,
                datetime.now(timezone.utc).isoformat(),
                run_id,
                event_type,
                MappingProxyType(copied),
            )
        )


class MonotonicIdSource:
    def __init__(self) -> None:
        self._next = 1

    def next(self, prefix: str) -> str:
        value = f"{prefix}-{self._next}"
        self._next += 1
        return value


@dataclass(frozen=True)
class UsageTotals:
    input_tokens: int
    output_tokens: int
    total_tokens: int


@dataclass(frozen=True)
class AgentRunSummary:
    run_id: str
    status: RunStatus
    turns: int
    conversation_revision: int
    usage: UsageTotals
    final_text: str | None = None
    error: str | None = None


class AgentRuntime:
    def __init__(
        self,
        *,
        model: ModelAdapter,
        tools: ToolRegistry,
        permission_gate: PermissionGate,
        max_turns: int = 8,
        max_tool_concurrency: int = 4,
        conversation: ConversationStore | None = None,
        trace: TraceRecorder | None = None,
        ids: MonotonicIdSource | None = None,
        request_projection_policy: RequestProjectionPolicy | None = None,
        compact_journal: CompactJournal | None = None,
    ) -> None:
        if isinstance(max_turns, bool) or not isinstance(max_turns, int):
            raise ValueError("max_turns must be an integer from 1 to 32")
        if max_turns < 1 or max_turns > 32:
            raise ValueError("max_turns must be an integer from 1 to 32")
        self._model = model
        self._tools = tools
        self._permission_gate = permission_gate
        self._max_turns = max_turns
        self._tool_scheduler = ToolScheduler(tools, max_tool_concurrency)
        self._tool_context: Mapping[str, object] = MappingProxyType({})
        self._conversation = conversation or ConversationStore()
        self._conversation.bind_runtime(self)
        self._trace = trace or TraceRecorder()
        self._ids = ids or MonotonicIdSource()
        self._request_projection_policy = (
            request_projection_policy or RequestProjectionPolicy()
        )
        self._result_budget_ledger = ResultBudgetLedger()
        self._compact_coordinator = CompactCoordinator(
            self._conversation, compact_journal
        )

    @property
    def trace(self) -> TraceRecorder:
        return self._trace

    @property
    def tool_context(self) -> Mapping[str, object]:
        return self._tool_context

    def conversation_snapshot(self) -> ConversationSnapshot:
        return self._conversation.snapshot()

    async def compact(
        self,
        summarizer: ConversationSummarizer,
        signal: CancellationSignal,
        *,
        retain_last: int = 8,
    ) -> CompactCommitSummary:
        transaction_id = self._ids.next("compact")
        run_lease = self._conversation.acquire_run(self)
        try:
            self._trace.record(
                transaction_id,
                "compact.started",
                {
                    "source_revision": self._conversation.revision,
                    "retain_last": retain_last,
                },
            )
            plan = await self._compact_coordinator.prepare(
                summarizer,
                transaction_id=transaction_id,
                boundary_id=self._ids.next("compact-boundary"),
                summary_id=self._ids.next("compact-summary"),
                retain_last=retain_last,
                signal=signal,
            )
            self._trace.record(
                transaction_id,
                "compact.prepared",
                {
                    "source_revision": plan.expected_revision,
                    "source_count": len(plan.original),
                    "summarized_count": len(
                        plan.provenance.summarized_message_ids
                    ),
                    "retained_count": len(plan.provenance.retained_message_ids),
                },
            )
            committed = self._compact_coordinator.commit(
                plan, run_lease, signal
            )
            self._trace.record(
                transaction_id,
                "compact.committed",
                {
                    "source_revision": committed.source_revision,
                    "committed_revision": committed.committed_revision,
                    "source_count": committed.source_count,
                    "summarized_count": committed.summarized_count,
                    "retained_count": committed.retained_count,
                },
            )
            return committed
        except Exception as error:
            self._trace.record(
                transaction_id,
                "compact.failed",
                {
                    "source_revision": self._conversation.revision,
                    "cancelled": signal.cancelled,
                    "error_type": type(error).__name__,
                },
            )
            raise
        finally:
            self._conversation.release_run(self, run_lease)

    async def submit(
        self, user_input: str, signal: CancellationSignal
    ) -> AgentRunSummary:
        _require_non_empty(user_input, "input")
        run_id = self._ids.next("run")
        run_lease = self._conversation.acquire_run(self)
        usage = [0, 0, 0]
        turns = 0

        try:
            self._trace.record(run_id, "run.started", {"max_turns": self._max_turns})
            self._append_human(user_input, run_lease)
            self._trace.record(
                run_id,
                "input.committed",
                {
                    "conversation_revision": self._conversation.revision,
                    "user_chars": len(user_input),
                },
            )

            for turns in range(1, self._max_turns + 1):
                if signal.cancelled:
                    return self._cancelled(run_id, turns - 1, usage, "before-request")

                request_revision = self._conversation.revision
                request, projection_report = self._project_request(
                    self._ids.next("request")
                )
                self._trace.record(
                    run_id,
                    "request.projected",
                    {
                        "request_id": request.request_id,
                        "turn": turns,
                        "message_count": len(request.messages),
                        "tool_count": len(request.tools),
                        "conversation_revision": self._conversation.revision,
                        "source_message_count": projection_report.source_count,
                        "selected_message_count": projection_report.selected_count,
                        "omitted_before_history_start": projection_report.omitted_before_history_start,
                        "replaced_tool_result_count": projection_report.replaced_tool_result_count,
                        "newly_replaced_tool_result_count": projection_report.newly_replaced_tool_result_count,
                        "reapplied_tool_result_count": projection_report.reapplied_tool_result_count,
                        "frozen_tool_result_count": projection_report.frozen_tool_result_count,
                        "aggregate_budget_group_count": projection_report.aggregate_budget_group_count,
                        "over_budget_tool_result_group_count": projection_report.over_budget_tool_result_group_count,
                        "replacement_revision": projection_report.replacement_revision,
                        "user_context_injected": projection_report.user_context_injected,
                        "strict_validation": projection_report.strict_validation,
                    },
                )
                try:
                    self._trace.record(
                        run_id,
                        "model.started",
                        {"request_id": request.request_id, "turn": turns},
                    )
                    response = await self._model.complete(request, signal)
                    signal.throw_if_cancelled()
                    _add_usage(usage, response.usage)
                    self._trace.record(
                        run_id,
                        "model.completed",
                        {
                            "request_id": request.request_id,
                            "turn": turns,
                            "tool_call_count": len(response.tool_calls),
                            "response_chars": len(response.text or ""),
                        },
                    )
                except asyncio.CancelledError:
                    return self._cancelled(run_id, turns, usage, "model-task")
                except Exception as error:
                    if signal.cancelled or isinstance(error, OperationCancelled):
                        return self._cancelled(run_id, turns, usage, "model")
                    return self._failed(run_id, turns, usage, _safe_error(error))

                assistant = self._append_assistant(
                    response, request_revision, run_lease
                )
                self._trace.record(
                    run_id,
                    "assistant.committed",
                    {
                        "response_id": response.response_id,
                        "message_id": str(assistant.id),
                        "tool_call_count": len(response.tool_calls),
                        "conversation_revision": self._conversation.revision,
                    },
                )
                if not response.tool_calls:
                    return self._completed(run_id, turns, usage, response.text)

                plan = self._tool_scheduler.plan(response.tool_calls)
                self._trace.record(
                    run_id,
                    "tools.planned",
                    {
                        "turn": turns,
                        "batch_count": len(plan.batches),
                        "concurrent_batch_count": sum(
                            batch.mode == "concurrent" for batch in plan.batches
                        ),
                        "exclusive_batch_count": sum(
                            batch.mode == "exclusive" for batch in plan.batches
                        ),
                        "max_concurrency": plan.max_concurrency,
                    },
                )

                async def started(call: ModelToolCall) -> None:
                    self._trace.record(
                        run_id,
                        "tool.started",
                        {
                            "turn": turns,
                            "tool_name": call.name,
                            "tool_use_id": call.id,
                        },
                    )

                async def progress(call: ModelToolCall, item: ToolProgress) -> None:
                    attributes: dict[str, Scalar] = {
                        "tool_name": call.name,
                        "tool_use_id": call.id,
                        "stage": item.stage,
                    }
                    if item.completed is not None:
                        attributes["completed"] = item.completed
                    if item.total is not None:
                        attributes["total"] = item.total
                    self._trace.record(run_id, "tool.progress", attributes)

                try:
                    outcomes, next_tool_context = await self._tool_scheduler.execute(
                        plan,
                        signal=signal,
                        gate=self._permission_gate,
                        initial_context=self._tool_context,
                        started=started,
                        progress=progress,
                    )
                except asyncio.CancelledError:
                    self._append_cancelled_results(
                        response.tool_calls,
                        assistant,
                        self._conversation.revision,
                        run_lease,
                    )
                    for call in response.tool_calls:
                        self._tool_finished(
                            run_id, call, "cancelled", "task-cancelled"
                        )
                    return self._cancelled(run_id, turns, usage, "tool-task")

                expected_revision = self._conversation.revision
                for outcome in outcomes:
                    self._append_tool_result(
                        outcome.call.id,
                        outcome.output,
                        outcome.is_error,
                        assistant,
                        expected_revision,
                        run_lease,
                    )
                    expected_revision = self._conversation.revision
                    self._tool_finished(
                        run_id, outcome.call, outcome.status, outcome.reason
                    )
                self._tool_context = next_tool_context
                if signal.cancelled:
                    return self._cancelled(run_id, turns, usage, "tool")

            self._trace.record(
                run_id, "run.max-turns", {"max_turns": self._max_turns}
            )
            return self._finish(run_id, "max-turns", self._max_turns, usage)
        except asyncio.CancelledError:
            return self._cancelled(run_id, max(0, turns), usage, "runtime-task")
        except Exception as error:
            if signal.cancelled or isinstance(error, OperationCancelled):
                return self._cancelled(run_id, max(0, turns), usage, "runtime")
            return self._failed(run_id, max(0, turns), usage, _safe_error(error))
        finally:
            self._conversation.release_run(self, run_lease)

    def _append_human(
        self, text: str, run_lease: ConversationRunLease
    ) -> None:
        self._conversation.append(
            self._conversation.revision,
            (HumanMessage("human", envelope_id(self._ids.next("message")), text),),
            run_lease,
        )

    def _append_assistant(
        self,
        response: ModelResponse,
        expected_revision: int,
        run_lease: ConversationRunLease,
    ) -> AssistantMessage:
        blocks = []
        if response.text:
            blocks.append(text_block(response.text))
        blocks.extend(
            tool_use_block(tool_use_id(call.id), call.name, call.input)
            for call in response.tool_calls
        )
        if not blocks:
            raise MessageInvariantError("assistant response has no blocks")
        message = AssistantMessage(
            "assistant",
            envelope_id(self._ids.next("message")),
            response_id(response.response_id),
            tuple(blocks),
        )
        self._conversation.append(expected_revision, (message,), run_lease)
        return message

    def _append_tool_result(
        self,
        raw_tool_use_id: str,
        output: str,
        is_error: bool,
        assistant: AssistantMessage,
        expected_revision: int,
        run_lease: ConversationRunLease,
    ) -> None:
        message = ToolResultMessage(
            "tool-result",
            envelope_id(self._ids.next("message")),
            tool_use_id(raw_tool_use_id),
            output,
            is_error,
            assistant.id,
        )
        self._conversation.append(expected_revision, (message,), run_lease)

    def _append_cancelled_results(
        self,
        calls: Sequence[ModelToolCall],
        assistant: AssistantMessage,
        expected_revision: int,
        run_lease: ConversationRunLease,
    ) -> None:
        next_revision = expected_revision
        for call in calls:
            self._append_tool_result(
                call.id,
                "cancelled before execution",
                True,
                assistant,
                next_revision,
                run_lease,
            )
            next_revision = self._conversation.revision

    def _project_request(
        self, request_id: str
    ) -> tuple[ModelRequest, RequestProjectionReport]:
        snapshot = self._conversation.snapshot()
        self._conversation.assert_request_ready(snapshot)
        policy = self._request_projection_policy
        if (
            isinstance(policy.history_start, bool)
            or not isinstance(policy.history_start, int)
            or policy.history_start < 0
            or policy.history_start > len(snapshot.messages)
        ):
            raise RequestProjectionError(
                "history_start must be a valid durable message index"
            )
        if (
            policy.max_tool_result_chars is not None
            and (
                isinstance(policy.max_tool_result_chars, bool)
                or not isinstance(policy.max_tool_result_chars, int)
                or policy.max_tool_result_chars < 1
            )
        ):
            raise RequestProjectionError(
                "max_tool_result_chars must be a positive integer"
            )
        if (
            policy.max_tool_result_group_chars is not None
            and (
                isinstance(policy.max_tool_result_group_chars, bool)
                or not isinstance(policy.max_tool_result_group_chars, int)
                or policy.max_tool_result_group_chars < 1
            )
        ):
            raise RequestProjectionError(
                "max_tool_result_group_chars must be a positive integer"
            )
        if (
            isinstance(policy.tool_result_preview_chars, bool)
            or not isinstance(policy.tool_result_preview_chars, int)
            or policy.tool_result_preview_chars < 0
        ):
            raise RequestProjectionError(
                "tool_result_preview_chars must be a non-negative integer"
            )

        selected = snapshot.messages[policy.history_start :]
        per_result_projected: list[ModelMessage] = []
        per_result_replaced = 0
        for message in selected:
            model_message = _project_message(message)
            if (
                model_message.role == "tool"
                and policy.max_tool_result_chars is not None
                and model_message.content is not None
                and len(model_message.content) > policy.max_tool_result_chars
            ):
                per_result_replaced += 1
                prefix = model_message.content[: policy.tool_result_preview_chars]
                model_message = ModelMessage(
                    "tool",
                    f"[tool result {model_message.tool_call_id} preview: "
                    f"{len(model_message.content)} chars; prefix={prefix!r}]",
                    tool_call_id=model_message.tool_call_id,
                )
            per_result_projected.append(model_message)

        ledger_snapshot = self._result_budget_ledger.snapshot()
        aggregate = (
            _empty_aggregate_projection(per_result_projected, ledger_snapshot.revision)
            if policy.max_tool_result_group_chars is None
            else _apply_aggregate_result_budget(
                per_result_projected,
                ledger_snapshot,
                policy.max_tool_result_group_chars,
                policy.tool_result_preview_chars,
            )
        )
        projected = list(aggregate.messages)

        user_context = policy.user_context.strip()
        if user_context:
            insertion_index = next(
                (
                    index
                    for index, message in enumerate(projected)
                    if message.role != "system"
                ),
                len(projected),
            )
            projected.insert(
                insertion_index,
                ModelMessage(
                    "user",
                    f"<system-reminder>\n{user_context}\n</system-reminder>",
                ),
            )
        _assert_strict_request_pairing(projected)
        replacement_revision = self._result_budget_ledger.commit(aggregate.change)
        request = ModelRequest(
            request_id,
            self._model.model,
            tuple(projected),
            self._tools.definitions(),
        )
        report = RequestProjectionReport(
            source_count=len(snapshot.messages),
            selected_count=len(selected),
            projected_count=len(projected),
            omitted_before_history_start=policy.history_start,
            replaced_tool_result_count=(
                per_result_replaced
                + aggregate.newly_replaced_count
                + aggregate.reapplied_count
            ),
            newly_replaced_tool_result_count=aggregate.newly_replaced_count,
            reapplied_tool_result_count=aggregate.reapplied_count,
            frozen_tool_result_count=aggregate.frozen_count,
            aggregate_budget_group_count=aggregate.group_count,
            over_budget_tool_result_group_count=aggregate.over_budget_group_count,
            replacement_revision=replacement_revision,
            user_context_injected=bool(user_context),
        )
        return request, report

    def _tool_finished(
        self,
        run_id: str,
        call: ModelToolCall,
        status: Literal["success", "error", "denied", "cancelled"],
        reason_category: str,
    ) -> None:
        self._trace.record(
            run_id,
            "tool.finished",
            {
                "tool_name": call.name,
                "tool_use_id": call.id,
                "status": status,
                "reason_category": reason_category,
                "conversation_revision": self._conversation.revision,
            },
        )

    def _completed(
        self,
        run_id: str,
        turns: int,
        usage: list[int],
        final_text: str | None,
    ) -> AgentRunSummary:
        self._trace.record(run_id, "run.completed", {"turns": turns})
        return self._finish(run_id, "completed", turns, usage, final_text)

    def _cancelled(
        self,
        run_id: str,
        turns: int,
        usage: list[int],
        phase: str,
    ) -> AgentRunSummary:
        safe_turns = max(0, turns)
        self._trace.record(
            run_id, "run.cancelled", {"phase": phase, "turns": safe_turns}
        )
        return self._finish(run_id, "cancelled", safe_turns, usage)

    def _failed(
        self, run_id: str, turns: int, usage: list[int], error: str
    ) -> AgentRunSummary:
        safe_turns = max(0, turns)
        self._trace.record(
            run_id,
            "run.failed",
            {"turns": safe_turns, "error_category": "runtime"},
        )
        return self._finish(run_id, "failed", safe_turns, usage, error=error)

    def _finish(
        self,
        run_id: str,
        status: RunStatus,
        turns: int,
        usage: list[int],
        final_text: str | None = None,
        error: str | None = None,
    ) -> AgentRunSummary:
        self._trace.record(run_id, "run.finished", {"status": status})
        return AgentRunSummary(
            run_id,
            status,
            turns,
            self._conversation.revision,
            UsageTotals(*usage),
            final_text,
            error,
        )


def _project_message(message: DurableMessage) -> ModelMessage:
    if isinstance(message, SystemMessage):
        return ModelMessage("system", message.text)
    if isinstance(message, HumanMessage):
        return ModelMessage("user", message.text)
    if isinstance(message, ToolResultMessage):
        return ModelMessage("tool", message.output, tool_call_id=str(message.tool_use_id))
    if isinstance(message, AssistantMessage):
        text = "\n".join(
            block.text for block in message.blocks if not isinstance(block, ToolUseBlock)
        )
        calls = tuple(
            ModelToolCall(str(block.id), block.name, _freeze_mapping(block.input))
            for block in message.blocks
            if isinstance(block, ToolUseBlock)
        )
        return ModelMessage("assistant", text or None, calls)
    raise TypeError(f"unknown durable message: {type(message).__name__}")


def _empty_aggregate_projection(
    messages: Sequence[ModelMessage], revision: int
) -> _AggregateProjection:
    return _AggregateProjection(
        tuple(messages),
        0,
        0,
        0,
        0,
        0,
        ResultBudgetLedgerChange(revision, frozenset(), ()),
    )


def _apply_aggregate_result_budget(
    messages: Sequence[ModelMessage],
    ledger: ResultBudgetLedgerSnapshot,
    limit: int,
    preview_chars: int,
) -> _AggregateProjection:
    projected = list(messages)
    groups: list[list[int]] = []
    current: list[int] = []
    for index, message in enumerate(messages):
        if message.role == "tool":
            current.append(index)
        elif current:
            groups.append(current)
            current = []
    if current:
        groups.append(current)

    seen_delta: set[str] = set()
    replacement_delta: dict[str, str] = {}
    newly_replaced = 0
    reapplied = 0
    frozen = 0
    over_budget_groups = 0
    prior_replacements = ledger.replacement_map()

    for group in groups:
        fresh: list[tuple[int, str, str]] = []
        for index in group:
            message = projected[index]
            call_id = message.tool_call_id or ""
            prior = prior_replacements.get(call_id)
            if prior is not None:
                projected[index] = ModelMessage(
                    "tool", prior, tool_call_id=call_id
                )
                reapplied += 1
            elif call_id in ledger.seen_ids:
                frozen += 1
            else:
                fresh.append((index, call_id, message.content or ""))

        projected_chars = sum(len(projected[index].content or "") for index in group)
        remaining = list(fresh)
        while projected_chars > limit and remaining:
            ranked = sorted(
                (
                    (
                        len(content) - len(_tool_result_preview(call_id, content, preview_chars)),
                        call_id,
                        index,
                        content,
                        _tool_result_preview(call_id, content, preview_chars),
                    )
                    for index, call_id, content in remaining
                ),
                key=lambda item: (-item[0], item[1]),
            )
            reduction, call_id, index, _content, preview = ranked[0]
            if reduction <= 0:
                break
            remaining = [item for item in remaining if item[1] != call_id]
            projected[index] = ModelMessage("tool", preview, tool_call_id=call_id)
            projected_chars -= reduction
            replacement_delta[call_id] = preview
            newly_replaced += 1

        seen_delta.update(call_id for _index, call_id, _content in fresh)
        if projected_chars > limit:
            over_budget_groups += 1

    return _AggregateProjection(
        tuple(projected),
        newly_replaced,
        reapplied,
        frozen,
        len(groups),
        over_budget_groups,
        ResultBudgetLedgerChange(
            ledger.revision,
            frozenset(seen_delta),
            tuple(sorted(replacement_delta.items())),
        ),
    )


def _tool_result_preview(call_id: str, content: str, preview_chars: int) -> str:
    return (
        f"[tool result {call_id} preview: {len(content)} chars; "
        f"prefix={content[:preview_chars]!r}]"
    )


def _assert_strict_request_pairing(messages: Sequence[ModelMessage]) -> None:
    pending: set[str] = set()
    for message in messages:
        if message.role == "tool":
            call_id = message.tool_call_id or ""
            if call_id not in pending:
                raise RequestProjectionError(
                    f"orphan or duplicate tool result: {call_id}"
                )
            pending.remove(call_id)
            continue
        if pending:
            raise RequestProjectionError(
                "missing tool results: " + ",".join(sorted(pending))
            )
        if message.role != "assistant":
            continue
        for call in message.tool_calls:
            if call.id in pending:
                raise RequestProjectionError(f"duplicate tool use id: {call.id}")
            pending.add(call.id)
    if pending:
        raise RequestProjectionError(
            "missing tool results: " + ",".join(sorted(pending))
        )


def _copy_request(request: ModelRequest) -> ModelRequest:
    return ModelRequest(
        request.request_id,
        request.model,
        tuple(
            ModelMessage(
                message.role,
                message.content,
                tuple(
                    ModelToolCall(call.id, call.name, _freeze_mapping(call.input))
                    for call in message.tool_calls
                ),
                message.tool_call_id,
            )
            for message in request.messages
        ),
        tuple(
            ModelToolDefinition(
                tool.name, tool.description, _freeze_mapping(tool.input_schema)
            )
            for tool in request.tools
        ),
    )


def _copy_response(response: ModelResponse) -> ModelResponse:
    _require_non_empty(response.response_id, "response_id")
    calls = tuple(
        ModelToolCall(
            _required(call.id, "tool call id"),
            _required(call.name, "tool name"),
            _freeze_mapping(call.input),
        )
        for call in response.tool_calls
    )
    return ModelResponse(response.response_id, response.text, calls, response.usage)


async def _safe_observer(
    callback: Callable[..., object | Awaitable[object]] | None,
    *args: object,
) -> None:
    if callback is None:
        return
    try:
        produced = callback(*args)
        if inspect.isawaitable(produced):
            await produced
    except Exception:
        # Observer callbacks never own execution or pairing.
        return


def _cancelled_tool_outcome(
    call: ModelToolCall, output: str
) -> ToolExecutionOutcome:
    return ToolExecutionOutcome(
        call,
        "cancelled",
        output or "operation cancelled",
        True,
        "cancellation",
    )


def _validate_tool_input(
    tool_input: Mapping[str, object], schema: Mapping[str, object]
) -> None:
    if schema.get("type") not in (None, "object"):
        raise ToolExecutionError("tool input schema must describe an object")
    raw_properties = schema.get("properties", {})
    properties = raw_properties if isinstance(raw_properties, Mapping) else {}
    raw_required = schema.get("required", ())
    required = (
        tuple(name for name in raw_required if isinstance(name, str))
        if isinstance(raw_required, Sequence) and not isinstance(raw_required, str)
        else ()
    )
    for name in required:
        if name not in tool_input:
            raise ToolExecutionError(f"{name} is required")
    if schema.get("additionalProperties") is False:
        for name in tool_input:
            if name not in properties:
                raise ToolExecutionError(f"{name} is not allowed")
    for name, value in tool_input.items():
        property_schema = properties.get(name)
        if isinstance(property_schema, Mapping):
            _validate_schema_value(value, property_schema, name)


def _validate_schema_value(
    value: object, schema: Mapping[str, object], name: str
) -> None:
    expected = schema.get("type")
    valid = True
    if expected == "string":
        valid = isinstance(value, str)
    elif expected == "integer":
        valid = isinstance(value, int) and not isinstance(value, bool)
    elif expected == "number":
        valid = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif expected == "boolean":
        valid = isinstance(value, bool)
    elif expected == "array":
        valid = isinstance(value, Sequence) and not isinstance(value, (str, bytes))
    elif expected == "object":
        valid = isinstance(value, Mapping)
    if not valid:
        raise ToolExecutionError(f"{name} must be a {expected}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, (int, float)) and value < minimum:
            raise ToolExecutionError(f"{name} must be at least {minimum}")
        if isinstance(maximum, (int, float)) and value > maximum:
            raise ToolExecutionError(f"{name} must be at most {maximum}")
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        max_items = schema.get("maxItems")
        if isinstance(max_items, int) and len(value) > max_items:
            raise ToolExecutionError(f"{name} has too many entries")
        item_schema = schema.get("items")
        if isinstance(item_schema, Mapping):
            for index, item in enumerate(value):
                _validate_schema_value(item, item_schema, f"{name}[{index}]")


async def _resolve_permission_decision(
    decision: PermissionDecision | Awaitable[PermissionDecision],
    signal: CancellationSignal,
) -> PermissionDecision:
    signal.throw_if_cancelled()
    if not inspect.isawaitable(decision):
        signal.throw_if_cancelled()
        return decision

    decision_task = asyncio.ensure_future(decision)
    cancellation_task = asyncio.create_task(signal.wait())
    try:
        done, _pending = await asyncio.wait(
            (decision_task, cancellation_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        if cancellation_task in done:
            decision_task.cancel()
            with suppress(asyncio.CancelledError):
                await decision_task
            raise OperationCancelled(signal.reason or "permission decision cancelled")
        result = await decision_task
        signal.throw_if_cancelled()
        return result
    finally:
        cancellation_task.cancel()
        with suppress(asyncio.CancelledError):
            await cancellation_task


def _serialize_output(value: object) -> str:
    rendered = value if isinstance(value, str) else json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), default=str
    )
    if len(rendered) <= 200_000:
        return rendered
    return rendered[:200_000] + "\n[tool output truncated]"


def _add_usage(target: list[int], usage: ModelUsage | None) -> None:
    if usage is None:
        return
    target[0] += usage.input_tokens
    target[1] += usage.output_tokens
    target[2] += (
        usage.total_tokens
        if usage.total_tokens is not None
        else usage.input_tokens + usage.output_tokens
    )


def _safe_error(error: BaseException) -> str:
    rendered = str(error).strip()
    return rendered or type(error).__name__


def _freeze_mapping(value: Mapping[str, object]) -> Mapping[str, object]:
    return MappingProxyType(
        {str(key): _freeze_value(item) for key, item in value.items()}
    )


def _freeze_value(value: object) -> object:
    if isinstance(value, Mapping):
        return _freeze_mapping(value)
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_value(item) for item in value)
    if isinstance(value, set):
        return frozenset(_freeze_value(item) for item in value)
    return deepcopy(value)


def _require_non_empty(value: str, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must not be empty")


def _required(value: str, name: str) -> str:
    _require_non_empty(value, name)
    return value


def _require_identifier(value: str, name: str) -> None:
    _require_non_empty(value, name)
    if not value[0].isalpha() or any(
        not (character.isalnum() or character in "_.:-") for character in value
    ):
        raise ValueError(f"{name} must use the portable ASCII identifier form")
    if not value.isascii():
        raise ValueError(f"{name} must use the portable ASCII identifier form")
