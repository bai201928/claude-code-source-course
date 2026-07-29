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


ToolHandler: TypeAlias = Callable[
    [Mapping[str, object], ToolContext], object | Awaitable[object]
]
PermissionRequestFactory: TypeAlias = Callable[
    [Mapping[str, object]], PermissionRequest
]


@dataclass(frozen=True)
class AgentTool:
    name: str
    description: str
    input_schema: Mapping[str, object]
    risk: ToolRisk
    execute: ToolHandler
    permission_request: PermissionRequestFactory


@dataclass(frozen=True)
class ToolDispatchResult:
    decision: PermissionDecision
    output: object


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
        request = tool.permission_request(_freeze_mapping(tool_input))
        decision = await _resolve_permission_decision(
            gate.decide(request, context.signal),
            context.signal,
        )
        if not decision.allowed:
            raise PermissionDeniedError(decision)
        context.signal.throw_if_cancelled()
        produced = tool.execute(_freeze_mapping(tool_input), context)
        output = await produced if inspect.isawaitable(produced) else produced
        context.signal.throw_if_cancelled()
        return ToolDispatchResult(decision, output)


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
        conversation: ConversationStore | None = None,
        trace: TraceRecorder | None = None,
        ids: MonotonicIdSource | None = None,
    ) -> None:
        if isinstance(max_turns, bool) or not isinstance(max_turns, int):
            raise ValueError("max_turns must be an integer from 1 to 32")
        if max_turns < 1 or max_turns > 32:
            raise ValueError("max_turns must be an integer from 1 to 32")
        self._model = model
        self._tools = tools
        self._permission_gate = permission_gate
        self._max_turns = max_turns
        self._conversation = conversation or ConversationStore()
        self._conversation.bind_runtime(self)
        self._trace = trace or TraceRecorder()
        self._ids = ids or MonotonicIdSource()

    @property
    def trace(self) -> TraceRecorder:
        return self._trace

    def conversation_snapshot(self) -> ConversationSnapshot:
        return self._conversation.snapshot()

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
                request = self._project_request(self._ids.next("request"))
                self._trace.record(
                    run_id,
                    "request.projected",
                    {
                        "request_id": request.request_id,
                        "turn": turns,
                        "message_count": len(request.messages),
                        "tool_count": len(request.tools),
                        "conversation_revision": self._conversation.revision,
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

                expected_revision = self._conversation.revision
                for index, call in enumerate(response.tool_calls):
                    if signal.cancelled:
                        self._append_cancelled_results(
                            response.tool_calls[index:],
                            assistant,
                            expected_revision,
                            run_lease,
                        )
                        return self._cancelled(run_id, turns, usage, "before-tool")
                    self._trace.record(
                        run_id,
                        "tool.started",
                        {
                            "turn": turns,
                            "tool_name": call.name,
                            "tool_use_id": call.id,
                        },
                    )
                    try:
                        dispatched = await self._tools.dispatch(
                            call.name,
                            call.input,
                            ToolContext(signal),
                            self._permission_gate,
                        )
                        self._append_tool_result(
                            call.id,
                            _serialize_output(dispatched.output),
                            False,
                            assistant,
                            expected_revision,
                            run_lease,
                        )
                        expected_revision = self._conversation.revision
                        self._tool_finished(
                            run_id, call, "success", "policy-allowed"
                        )
                    except asyncio.CancelledError:
                        self._append_tool_result(
                            call.id,
                            "cancelled during execution",
                            True,
                            assistant,
                            expected_revision,
                            run_lease,
                        )
                        expected_revision = self._conversation.revision
                        self._tool_finished(run_id, call, "cancelled", "task-cancelled")
                        self._append_cancelled_results(
                            response.tool_calls[index + 1 :],
                            assistant,
                            expected_revision,
                            run_lease,
                        )
                        return self._cancelled(run_id, turns, usage, "tool-task")
                    except Exception as error:
                        cancelled = signal.cancelled or isinstance(
                            error, OperationCancelled
                        )
                        denied = isinstance(error, PermissionDeniedError)
                        self._append_tool_result(
                            call.id,
                            _safe_error(error),
                            True,
                            assistant,
                            expected_revision,
                            run_lease,
                        )
                        expected_revision = self._conversation.revision
                        status = (
                            "cancelled" if cancelled else "denied" if denied else "error"
                        )
                        category = (
                            "cancellation"
                            if cancelled
                            else "permission"
                            if denied
                            else "tool-execution"
                        )
                        self._tool_finished(run_id, call, status, category)
                        if cancelled:
                            self._append_cancelled_results(
                                response.tool_calls[index + 1 :],
                                assistant,
                                expected_revision,
                                run_lease,
                            )
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

    def _project_request(self, request_id: str) -> ModelRequest:
        snapshot = self._conversation.snapshot()
        self._conversation.assert_request_ready(snapshot)
        return ModelRequest(
            request_id,
            self._model.model,
            tuple(_project_message(message) for message in snapshot.messages),
            self._tools.definitions(),
        )

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
