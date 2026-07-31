from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping, Sequence
from copy import deepcopy
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal, Protocol

DecisionBehavior = Literal["allow", "ask", "deny"]
EvidenceBehavior = DecisionBehavior | Literal["continue", "stop"]


class CancellationView(Protocol):
    @property
    def cancelled(self) -> bool: ...
    def throw_if_cancelled(self) -> None: ...


class PermissionView(Protocol):
    allowed: bool
    reason: str


@dataclass(frozen=True)
class DecisionEvidence:
    stage: Literal["pre-hook", "policy", "resolver", "post-hook", "abort"]
    source_id: str
    behavior: EvidenceBehavior
    revision: int


@dataclass(frozen=True)
class DecisionContext:
    call_id: str
    tool_name: str
    revision: int
    input: Mapping[str, object]


@dataclass(frozen=True)
class PreHookResult:
    behavior: DecisionBehavior | None = None
    updated_input: Mapping[str, object] | None = None


@dataclass(frozen=True)
class Resolution:
    allowed: bool
    reason: str
    updated_input: Mapping[str, object] | None = None


@dataclass(frozen=True)
class PreparedDecision:
    context: DecisionContext
    decision: Resolution
    evidence: tuple[DecisionEvidence, ...]


@dataclass(frozen=True)
class PostDecision:
    continue_conversation: bool
    evidence: tuple[DecisionEvidence, ...]


PreHook = Callable[
    [DecisionContext, CancellationView],
    PreHookResult | Awaitable[PreHookResult],
]
PostHook = Callable[
    [DecisionContext, bool, CancellationView],
    bool | Awaitable[bool],
]
AskResolver = Callable[
    [DecisionContext, tuple[DecisionEvidence, ...], CancellationView],
    PermissionView | Awaitable[PermissionView],
]


class ExtensionDecisionPipeline:
    def __init__(
        self,
        *,
        pre_hooks: Sequence[tuple[str, PreHook]] = (),
        post_hooks: Sequence[tuple[str, PostHook]] = (),
        ask_resolver: AskResolver | None = None,
    ) -> None:
        ids = [hook_id for hook_id, _hook in (*pre_hooks, *post_hooks)]
        if any(not hook_id.strip() for hook_id in ids):
            raise ValueError("hook id must not be empty")
        if len(ids) != len(set(ids)):
            raise ValueError("hook ids must be unique")
        self._pre_hooks = tuple(pre_hooks)
        self._post_hooks = tuple(post_hooks)
        self._ask_resolver = ask_resolver

    async def prepare(
        self,
        *,
        call_id: str,
        tool_name: str,
        tool_input: Mapping[str, object],
        validate_schema: Callable[[Mapping[str, object]], None],
        validate_semantics: Callable[
            [Mapping[str, object]], object | Awaitable[object]
        ] | None,
        decide_policy: Callable[
            [Mapping[str, object]], PermissionView | Awaitable[PermissionView]
        ],
        signal: CancellationView,
    ) -> PreparedDecision:
        signal.throw_if_cancelled()
        context = _context(call_id, tool_name, 0, tool_input)
        evidence: list[DecisionEvidence] = []
        proposals: list[DecisionBehavior] = []
        await _validate(context.input, validate_schema, validate_semantics)

        for hook_id, hook in self._pre_hooks:
            signal.throw_if_cancelled()
            result = await _maybe_await(hook(context, signal))
            if result.updated_input is not None:
                context = _context(
                    call_id, tool_name, context.revision + 1, result.updated_input
                )
                await _validate(context.input, validate_schema, validate_semantics)
            if result.behavior is not None:
                proposals.append(result.behavior)
                evidence.append(
                    DecisionEvidence(
                        "pre-hook", hook_id, result.behavior, context.revision
                    )
                )

        signal.throw_if_cancelled()
        policy = await _maybe_await(decide_policy(context.input))
        signal.throw_if_cancelled()
        evidence.append(
            DecisionEvidence(
                "policy",
                "permission-gate",
                "allow" if policy.allowed else "deny",
                context.revision,
            )
        )
        if not policy.allowed or "deny" in proposals:
            reason = policy.reason if not policy.allowed else "pre-hook-deny"
            return PreparedDecision(
                context, Resolution(False, reason), tuple(evidence)
            )

        if "ask" in proposals:
            if self._ask_resolver is None:
                evidence.append(
                    DecisionEvidence(
                        "resolver", "missing-resolver", "deny", context.revision
                    )
                )
                return PreparedDecision(
                    context,
                    Resolution(False, "approval-required-without-resolver"),
                    tuple(evidence),
                )
            try:
                resolved = await _maybe_await(
                    self._ask_resolver(context, tuple(evidence), signal)
                )
                signal.throw_if_cancelled()
            except Exception:
                if signal.cancelled:
                    raise
                evidence.append(
                    DecisionEvidence(
                        "resolver", "resolver-error", "deny", context.revision
                    )
                )
                return PreparedDecision(
                    context,
                    Resolution(False, "approval-resolver-failed"),
                    tuple(evidence),
                )
            evidence.append(
                DecisionEvidence(
                    "resolver",
                    "ask-resolver",
                    "allow" if resolved.allowed else "deny",
                    context.revision,
                )
            )
            if not resolved.allowed:
                return PreparedDecision(
                    context,
                    Resolution(False, resolved.reason),
                    tuple(evidence),
                )
            updated_input = getattr(resolved, "updated_input", None)
            if updated_input is not None:
                context = _context(
                    call_id, tool_name, context.revision + 1, updated_input
                )
                await _validate(
                    context.input, validate_schema, validate_semantics
                )
                signal.throw_if_cancelled()
                rewritten_policy = await _maybe_await(
                    decide_policy(context.input)
                )
                signal.throw_if_cancelled()
                evidence.append(
                    DecisionEvidence(
                        "policy",
                        "permission-gate-after-resolver-rewrite",
                        "allow" if rewritten_policy.allowed else "deny",
                        context.revision,
                    )
                )
                if not rewritten_policy.allowed:
                    return PreparedDecision(
                        context,
                        Resolution(False, rewritten_policy.reason),
                        tuple(evidence),
                    )

        signal.throw_if_cancelled()
        return PreparedDecision(
            context, Resolution(True, policy.reason), tuple(evidence)
        )

    async def after(
        self,
        prepared: PreparedDecision,
        *,
        succeeded: bool,
        signal: CancellationView,
    ) -> PostDecision:
        evidence = list(prepared.evidence)
        continue_conversation = True
        for hook_id, hook in self._post_hooks:
            block = bool(
                await _maybe_await(hook(prepared.context, succeeded, signal))
            )
            if block:
                continue_conversation = False
            evidence.append(
                DecisionEvidence(
                    "post-hook",
                    hook_id,
                    "stop" if block else "continue",
                    prepared.context.revision,
                )
            )
        return PostDecision(continue_conversation, tuple(evidence))


async def _validate(
    tool_input: Mapping[str, object],
    schema: Callable[[Mapping[str, object]], None],
    semantics: Callable[[Mapping[str, object]], object | Awaitable[object]] | None,
) -> None:
    schema(tool_input)
    if semantics is not None:
        await _maybe_await(semantics(tool_input))


async def _maybe_await(value):
    return await value if inspect.isawaitable(value) else value


def _context(
    call_id: str,
    tool_name: str,
    revision: int,
    tool_input: Mapping[str, object],
) -> DecisionContext:
    return DecisionContext(
        call_id,
        tool_name,
        revision,
        MappingProxyType(deepcopy(dict(tool_input))),
    )
