from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable, Literal, Protocol

from conversation_store import (
    ConversationRunLease,
    ConversationSnapshot,
    ConversationStore,
    DurableMessage,
    MessageInvariantError,
    SystemMessage,
    envelope_id,
)


class CompactSignal(Protocol):
    @property
    def cancelled(self) -> bool: ...

    def throw_if_cancelled(self) -> None: ...


class ConversationSummarizer(Protocol):
    async def summarize(
        self, messages: tuple[DurableMessage, ...], signal: CompactSignal
    ) -> str: ...


@dataclass(frozen=True)
class CompactProvenance:
    transaction_id: str
    source_revision: int
    source_message_ids: tuple[str, ...]
    summarized_message_ids: tuple[str, ...]
    retained_message_ids: tuple[str, ...]
    boundary_id: str
    summary_id: str


@dataclass(frozen=True)
class CompactPlan:
    expected_revision: int
    original: tuple[DurableMessage, ...]
    replacement: tuple[DurableMessage, ...]
    provenance: CompactProvenance


@dataclass(frozen=True)
class CompactJournalRecord:
    phase: Literal["prepared", "committed"]
    original: tuple[DurableMessage, ...]
    replacement: tuple[DurableMessage, ...]
    provenance: CompactProvenance


class CompactJournal(Protocol):
    def append(self, record: CompactJournalRecord) -> None: ...

    def records(self) -> tuple[CompactJournalRecord, ...]: ...


@dataclass(frozen=True)
class CompactCommitSummary:
    transaction_id: str
    source_revision: int
    committed_revision: int
    source_count: int
    summarized_count: int
    retained_count: int


@dataclass(frozen=True)
class CompactRecoveryReport:
    status: Literal["restored", "fell_back", "repair_required"]
    source_revision: int
    source_count: int
    summarized_count: int
    retained_count: int
    restored_count: int
    transaction_id: str | None = None
    target_revision: int | None = None
    reason: Literal[
        "no_record",
        "prepared_only",
        "missing_boundary",
        "missing_summary",
        "malformed_provenance",
    ] | None = None


class CompactInvariantError(ValueError):
    pass


class InMemoryCompactJournal:
    def __init__(
        self,
        after_append: Callable[[CompactJournalRecord], None] | None = None,
    ) -> None:
        self._records: list[CompactJournalRecord] = []
        self._after_append = after_append

    def append(self, record: CompactJournalRecord) -> None:
        self._records.append(record)
        if self._after_append is not None:
            self._after_append(record)

    def records(self) -> tuple[CompactJournalRecord, ...]:
        return tuple(self._records)


class CompactCoordinator:
    def __init__(
        self,
        store: ConversationStore,
        journal: CompactJournal | None = None,
    ) -> None:
        self._store = store
        self._journal = journal or InMemoryCompactJournal()

    async def prepare(
        self,
        summarizer: ConversationSummarizer,
        *,
        transaction_id: str,
        boundary_id: str,
        summary_id: str,
        retain_last: int,
        signal: CompactSignal,
    ) -> CompactPlan:
        _require_identifier(transaction_id, "transaction id")
        _require_identifier(boundary_id, "boundary id")
        _require_identifier(summary_id, "summary id")
        if (
            isinstance(retain_last, bool)
            or not isinstance(retain_last, int)
            or retain_last < 0
        ):
            raise CompactInvariantError(
                "retain_last must be a non-negative integer"
            )
        signal.throw_if_cancelled()
        snapshot = self._store.snapshot()
        leading_systems = _count_leading_system_messages(snapshot.messages)
        retained_start = _find_retained_start(
            snapshot.messages,
            leading_systems,
            retain_last,
            boundary_id,
            summary_id,
        )
        summarized = snapshot.messages[leading_systems:retained_start]
        retained = snapshot.messages[retained_start:]
        if not summarized:
            raise CompactInvariantError(
                "compact requires at least one summarized message"
            )
        summary = (await summarizer.summarize(summarized, signal)).strip()
        signal.throw_if_cancelled()
        if not summary:
            raise CompactInvariantError("summary must not be empty")
        replacement = _build_replacement(
            snapshot.messages[:leading_systems],
            retained,
            boundary_id,
            summary_id,
            summary,
        )
        _validate_request_ready(replacement)
        provenance = CompactProvenance(
            transaction_id,
            snapshot.revision,
            tuple(str(message.id) for message in snapshot.messages),
            tuple(str(message.id) for message in summarized),
            tuple(str(message.id) for message in retained),
            boundary_id,
            summary_id,
        )
        return CompactPlan(
            snapshot.revision,
            snapshot.messages,
            replacement,
            provenance,
        )

    def commit(
        self,
        plan: CompactPlan,
        run_lease: ConversationRunLease,
        signal: CompactSignal,
    ) -> CompactCommitSummary:
        signal.throw_if_cancelled()
        _validate_plan(plan)
        self._require_current_revision(plan.expected_revision)
        _validate_request_ready(plan.replacement)
        self._journal.append(
            CompactJournalRecord(
                "prepared", plan.original, plan.replacement, plan.provenance
            )
        )
        signal.throw_if_cancelled()
        self._require_current_revision(plan.expected_revision)
        self._journal.append(
            CompactJournalRecord(
                "committed", plan.original, plan.replacement, plan.provenance
            )
        )
        snapshot = self._store.replace(
            plan.expected_revision, plan.replacement, run_lease
        )
        return CompactCommitSummary(
            plan.provenance.transaction_id,
            plan.expected_revision,
            snapshot.revision,
            len(plan.original),
            len(plan.provenance.summarized_message_ids),
            len(plan.provenance.retained_message_ids),
        )

    def records(self) -> tuple[CompactJournalRecord, ...]:
        return self._journal.records()

    def _require_current_revision(self, expected: int) -> None:
        if self._store.revision != expected:
            raise CompactInvariantError(
                f"stale compact revision {expected}; current={self._store.revision}"
            )


def recover_compaction(
    fallback: ConversationSnapshot,
    records: tuple[CompactJournalRecord, ...],
) -> tuple[tuple[DurableMessage, ...], CompactRecoveryReport]:
    if not records:
        return fallback.messages, _recovery_report(
            fallback.messages, fallback.revision, "fell_back", "no_record"
        )
    latest = records[-1]
    if latest.phase != "committed":
        return latest.original, _recovery_report(
            latest.original,
            latest.provenance.source_revision,
            "fell_back",
            "prepared_only",
            latest,
        )
    reason = _validate_recovery_record(latest)
    if reason is not None:
        return latest.original, _recovery_report(
            latest.original,
            latest.provenance.source_revision,
            "repair_required",
            reason,
            latest,
        )
    return latest.replacement, _recovery_report(
        latest.replacement,
        latest.provenance.source_revision,
        "restored",
        None,
        latest,
    )


def _find_retained_start(
    messages: tuple[DurableMessage, ...],
    floor: int,
    retain_last: int,
    boundary_id: str,
    summary_id: str,
) -> int:
    start = max(floor, len(messages) - retain_last)
    while start > floor:
        candidate = _build_replacement(
            messages[:floor],
            messages[start:],
            boundary_id,
            summary_id,
            "prepared summary",
        )
        try:
            _validate_request_ready(candidate)
            return start
        except MessageInvariantError:
            start -= 1
    return start


def _build_replacement(
    leading_systems: tuple[DurableMessage, ...],
    retained: tuple[DurableMessage, ...],
    boundary_id: str,
    summary_id: str,
    summary: str,
) -> tuple[DurableMessage, ...]:
    raw: tuple[DurableMessage, ...] = (
        *leading_systems,
        SystemMessage(
            "system", envelope_id(boundary_id), "Conversation compacted"
        ),
        SystemMessage("system", envelope_id(summary_id), summary),
        *retained,
    )
    rebased: list[DurableMessage] = []
    parent_id = None
    for message in raw:
        rebased.append(replace(message, parent_id=parent_id))
        parent_id = message.id
    return tuple(rebased)


def _validate_plan(plan: CompactPlan) -> None:
    if plan.provenance.source_revision != plan.expected_revision:
        raise CompactInvariantError("compact provenance revision mismatch")
    if tuple(str(item.id) for item in plan.original) != (
        plan.provenance.source_message_ids
    ):
        raise CompactInvariantError("compact source provenance mismatch")
    reason = _validate_recovery_record(
        CompactJournalRecord(
            "committed", plan.original, plan.replacement, plan.provenance
        )
    )
    if reason is not None:
        raise CompactInvariantError(reason)


def _validate_recovery_record(
    record: CompactJournalRecord,
) -> Literal["missing_boundary", "missing_summary", "malformed_provenance"] | None:
    try:
        _validate_request_ready(record.original)
        _validate_request_ready(record.replacement)
    except MessageInvariantError:
        return "malformed_provenance"
    boundary = next(
        (
            message
            for message in record.replacement
            if str(message.id) == record.provenance.boundary_id
        ),
        None,
    )
    if not isinstance(boundary, SystemMessage) or boundary.text != "Conversation compacted":
        return "missing_boundary"
    summary = next(
        (
            message
            for message in record.replacement
            if str(message.id) == record.provenance.summary_id
        ),
        None,
    )
    if not isinstance(summary, SystemMessage):
        return "missing_summary"
    if tuple(str(item.id) for item in record.original) != (
        record.provenance.source_message_ids
    ):
        return "malformed_provenance"
    replacement_ids = {str(item.id) for item in record.replacement}
    if any(
        item not in replacement_ids
        for item in record.provenance.retained_message_ids
    ):
        return "malformed_provenance"
    return None


def _recovery_report(
    restored: tuple[DurableMessage, ...],
    source_revision: int,
    status: Literal["restored", "fell_back", "repair_required"],
    reason,
    record: CompactJournalRecord | None = None,
) -> CompactRecoveryReport:
    return CompactRecoveryReport(
        status=status,
        source_revision=source_revision,
        source_count=len(record.original) if record else len(restored),
        summarized_count=(
            len(record.provenance.summarized_message_ids) if record else 0
        ),
        retained_count=(
            len(record.provenance.retained_message_ids) if record else 0
        ),
        restored_count=len(restored),
        transaction_id=record.provenance.transaction_id if record else None,
        target_revision=source_revision + 1 if status == "restored" else None,
        reason=reason,
    )


def _validate_request_ready(messages: tuple[DurableMessage, ...]) -> None:
    candidate = ConversationStore(messages)
    candidate.assert_request_ready(candidate.snapshot())


def _count_leading_system_messages(
    messages: tuple[DurableMessage, ...]
) -> int:
    count = 0
    for message in messages:
        if not isinstance(message, SystemMessage):
            break
        count += 1
    return count


def _require_identifier(value: str, name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise CompactInvariantError(f"{name} must not be empty")
