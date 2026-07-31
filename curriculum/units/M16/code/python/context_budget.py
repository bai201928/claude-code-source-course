from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Literal


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str


@dataclass(frozen=True)
class Envelope:
    kind: Literal["assistant", "tool-result", "progress", "attachment", "user"]
    response_id: str = ""
    calls: tuple[ToolCall, ...] = ()
    call_id: str = ""
    content: str = ""
    text: str = ""
    self_bounded: bool = False


@dataclass(frozen=True)
class AggregateBudgetPolicy:
    max_group_chars: int
    preview_chars: int
    history_start: int = 0


@dataclass(frozen=True)
class ReplacementMetadata:
    group_index: int
    call_id: str
    status: Literal["new", "reapplied"]
    original_chars: int
    projected_chars: int


@dataclass(frozen=True)
class GroupBudgetMetadata:
    group_index: int
    result_count: int
    excluded_count: int
    projected_chars: int
    over_budget: bool


@dataclass(frozen=True)
class BudgetReport:
    source_count: int
    selected_count: int
    omitted_before_history_start: int
    replacement_revision: int
    newly_replaced_count: int
    reapplied_count: int
    frozen_count: int
    groups: tuple[GroupBudgetMetadata, ...]
    replacements: tuple[ReplacementMetadata, ...]
    strict_validation: Literal["passed"] = "passed"


@dataclass(frozen=True)
class LedgerSnapshot:
    revision: int
    seen_ids: frozenset[str]
    replacements: tuple[tuple[str, str], ...]

    def replacement_map(self) -> dict[str, str]:
        return dict(self.replacements)


@dataclass(frozen=True)
class LedgerCommit:
    expected_revision: int
    seen_ids: frozenset[str]
    replacements: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class ProjectionPlan:
    messages: tuple[Envelope, ...]
    report: BudgetReport
    ledger_commit: LedgerCommit


class ContextProjectionError(ValueError):
    pass


class StaleReplacementRevisionError(RuntimeError):
    pass


class ResultBudgetLedger:
    def __init__(self) -> None:
        self._revision = 0
        self._seen_ids: set[str] = set()
        self._replacements: dict[str, str] = {}

    def snapshot(self) -> LedgerSnapshot:
        return LedgerSnapshot(
            self._revision,
            frozenset(self._seen_ids),
            tuple(sorted(self._replacements.items())),
        )

    def commit(self, change: LedgerCommit) -> int:
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
class _Candidate:
    message_index: int
    call_id: str
    content: str
    self_bounded: bool


def plan_aggregate_projection(
    source: tuple[Envelope, ...] | list[Envelope],
    ledger: LedgerSnapshot,
    policy: AggregateBudgetPolicy,
) -> ProjectionPlan:
    _validate_policy(source, policy)
    selected = tuple(source[policy.history_start :])
    projected = list(selected)
    seen_delta: set[str] = set()
    replacement_delta: dict[str, str] = {}
    replacement_meta: list[ReplacementMetadata] = []
    group_meta: list[GroupBudgetMetadata] = []
    newly_replaced = 0
    reapplied = 0
    frozen = 0
    prior_replacements = ledger.replacement_map()

    for group_index, group in enumerate(_collect_final_user_groups(selected)):
        fresh: list[_Candidate] = []
        excluded = 0
        for candidate in group:
            prior = prior_replacements.get(candidate.call_id)
            if prior is not None:
                projected[candidate.message_index] = replace(
                    projected[candidate.message_index], content=prior
                )
                replacement_meta.append(
                    ReplacementMetadata(
                        group_index,
                        candidate.call_id,
                        "reapplied",
                        len(candidate.content),
                        len(prior),
                    )
                )
                reapplied += 1
            elif candidate.call_id in ledger.seen_ids:
                frozen += 1
            elif candidate.self_bounded:
                seen_delta.add(candidate.call_id)
                excluded += 1
            else:
                fresh.append(candidate)

        projected_chars = sum(
            len(projected[candidate.message_index].content) for candidate in group
        )
        remaining = list(fresh)
        while projected_chars > policy.max_group_chars and remaining:
            ranked = sorted(
                (
                    (
                        len(candidate.content)
                        - len(_build_preview(candidate, policy.preview_chars)),
                        candidate.call_id,
                        candidate,
                        _build_preview(candidate, policy.preview_chars),
                    )
                    for candidate in remaining
                ),
                key=lambda item: (-item[0], item[1]),
            )
            reduction, _, candidate, preview = ranked[0]
            if reduction <= 0:
                break
            remaining.remove(candidate)
            projected[candidate.message_index] = replace(
                projected[candidate.message_index], content=preview
            )
            projected_chars -= reduction
            replacement_delta[candidate.call_id] = preview
            replacement_meta.append(
                ReplacementMetadata(
                    group_index,
                    candidate.call_id,
                    "new",
                    len(candidate.content),
                    len(preview),
                )
            )
            newly_replaced += 1

        seen_delta.update(candidate.call_id for candidate in fresh)
        group_meta.append(
            GroupBudgetMetadata(
                group_index,
                len(group),
                excluded,
                projected_chars,
                projected_chars > policy.max_group_chars,
            )
        )

    assert_strict_pairing(projected)
    will_change = bool(seen_delta or replacement_delta)
    return ProjectionPlan(
        tuple(projected),
        BudgetReport(
            len(source),
            len(selected),
            policy.history_start,
            ledger.revision + (1 if will_change else 0),
            newly_replaced,
            reapplied,
            frozen,
            tuple(group_meta),
            tuple(replacement_meta),
        ),
        LedgerCommit(
            ledger.revision,
            frozenset(seen_delta),
            tuple(sorted(replacement_delta.items())),
        ),
    )


def project_and_commit(
    source: tuple[Envelope, ...] | list[Envelope],
    ledger: ResultBudgetLedger,
    policy: AggregateBudgetPolicy,
) -> ProjectionPlan:
    plan = plan_aggregate_projection(source, ledger.snapshot(), policy)
    revision = ledger.commit(plan.ledger_commit)
    return replace(plan, report=replace(plan.report, replacement_revision=revision))


def apply_per_result_preview(
    source: tuple[Envelope, ...] | list[Envelope],
    max_result_chars: int,
    preview_chars: int,
) -> tuple[Envelope, ...]:
    if max_result_chars < 1:
        raise ContextProjectionError("max_result_chars must be positive")
    result: list[Envelope] = []
    for message in source:
        if (
            message.kind == "tool-result"
            and not message.self_bounded
            and len(message.content) > max_result_chars
        ):
            candidate = _Candidate(0, message.call_id, message.content, False)
            result.append(replace(message, content=_build_preview(candidate, preview_chars)))
        else:
            result.append(message)
    assert_strict_pairing(result)
    return tuple(result)


def naive_global_suffix(
    source: tuple[Envelope, ...] | list[Envelope], max_chars: int
) -> tuple[Envelope, ...]:
    used = 0
    start = len(source)
    for index in range(len(source) - 1, -1, -1):
        size = _envelope_chars(source[index])
        if used + size > max_chars:
            break
        used += size
        start = index
    selected = tuple(source[start:])
    assert_strict_pairing(selected)
    return selected


def total_tool_result_chars(messages: tuple[Envelope, ...] | list[Envelope]) -> int:
    return sum(len(message.content) for message in messages if message.kind == "tool-result")


def assert_strict_pairing(messages: tuple[Envelope, ...] | list[Envelope]) -> None:
    calls: set[str] = set()
    results: set[str] = set()
    for message in messages:
        if message.kind == "assistant":
            for call in message.calls:
                if call.id in calls:
                    raise ContextProjectionError(f"duplicate tool use id: {call.id}")
                calls.add(call.id)
        elif message.kind == "tool-result":
            if message.call_id not in calls or message.call_id in results:
                raise ContextProjectionError(
                    f"orphan or duplicate tool result: {message.call_id}"
                )
            results.add(message.call_id)
    missing = sorted(calls - results)
    if missing:
        raise ContextProjectionError("missing tool results: " + ",".join(missing))


def _collect_final_user_groups(messages: tuple[Envelope, ...]) -> list[list[_Candidate]]:
    groups: list[list[_Candidate]] = []
    current: list[_Candidate] = []
    seen_response_ids: set[str] = set()

    def flush() -> None:
        nonlocal current
        if current:
            groups.append(current)
        current = []

    for index, message in enumerate(messages):
        if message.kind == "tool-result":
            current.append(
                _Candidate(
                    index,
                    message.call_id,
                    message.content,
                    message.self_bounded,
                )
            )
        elif message.kind == "assistant" and message.response_id not in seen_response_ids:
            flush()
            seen_response_ids.add(message.response_id)
    flush()
    return groups


def _build_preview(candidate: _Candidate, preview_chars: int) -> str:
    prefix = candidate.content[:preview_chars]
    return (
        f"[tool result {candidate.call_id} preview: {len(candidate.content)} chars; "
        f"prefix={prefix!r}]"
    )


def _envelope_chars(message: Envelope) -> int:
    if message.kind == "assistant":
        return sum(len(call.id) + len(call.name) for call in message.calls)
    if message.kind == "tool-result":
        return len(message.content)
    return len(message.text)


def _validate_policy(
    source: tuple[Envelope, ...] | list[Envelope], policy: AggregateBudgetPolicy
) -> None:
    if policy.history_start < 0 or policy.history_start > len(source):
        raise ContextProjectionError("history_start is outside the source")
    if policy.max_group_chars < 1:
        raise ContextProjectionError("max_group_chars must be positive")
    if policy.preview_chars < 0:
        raise ContextProjectionError("preview_chars must be non-negative")
