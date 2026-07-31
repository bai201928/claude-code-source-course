from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable, Literal, Protocol

MessageKind = Literal[
    "human",
    "assistant",
    "tool-use",
    "tool-result",
    "compact-boundary",
    "compact-summary",
]


@dataclass(frozen=True)
class CompactMessage:
    id: str
    kind: MessageKind
    content: str
    tool_use_id: str | None = None


@dataclass(frozen=True)
class CompactSnapshot:
    revision: int
    messages: tuple[CompactMessage, ...]


@dataclass(frozen=True)
class CompactProvenance:
    transaction_id: str
    source_revision: int
    source_message_ids: tuple[str, ...]
    retained_message_ids: tuple[str, ...]
    boundary_id: str
    summary_id: str


@dataclass(frozen=True)
class CompactPlan:
    expected_revision: int
    original: tuple[CompactMessage, ...]
    replacement: tuple[CompactMessage, ...]
    provenance: CompactProvenance


@dataclass(frozen=True)
class CompactJournalRecord:
    phase: Literal["prepared", "committed"]
    original: tuple[CompactMessage, ...]
    replacement: tuple[CompactMessage, ...]
    provenance: CompactProvenance


@dataclass(frozen=True)
class CompactRecoveryReport:
    status: Literal["restored", "fell_back", "repair_required"]
    source_revision: int
    source_count: int
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


@dataclass(frozen=True)
class CompactRecoveryResult:
    snapshot: CompactSnapshot
    report: CompactRecoveryReport


class CompactSummarizer(Protocol):
    async def summarize(
        self, messages: tuple[CompactMessage, ...], cancel: "CancelSignal"
    ) -> str: ...


class CompactCancelledError(RuntimeError):
    pass


class StaleCompactRevisionError(RuntimeError):
    pass


class CompactInvariantError(ValueError):
    pass


class CancelSignal:
    def __init__(self) -> None:
        self._cancelled = False

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def cancel(self) -> None:
        self._cancelled = True

    def throw_if_cancelled(self) -> None:
        if self._cancelled:
            raise CompactCancelledError("compact cancelled")


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


class CompactConversationOwner:
    def __init__(
        self, messages: tuple[CompactMessage, ...], revision: int = 0
    ) -> None:
        _require_revision(revision)
        _validate_messages(messages)
        self._revision = revision
        self._messages = tuple(messages)

    def snapshot(self) -> CompactSnapshot:
        return CompactSnapshot(self._revision, self._messages)

    def append(
        self, expected_revision: int, messages: tuple[CompactMessage, ...]
    ) -> CompactSnapshot:
        self._require_revision(expected_revision)
        replacement = self._messages + messages
        _validate_messages(replacement)
        self._messages = replacement
        self._revision += 1
        return self.snapshot()

    def validate_replacement(
        self, expected_revision: int, messages: tuple[CompactMessage, ...]
    ) -> None:
        self._require_revision(expected_revision)
        _validate_messages(messages)

    def replace(
        self, expected_revision: int, messages: tuple[CompactMessage, ...]
    ) -> CompactSnapshot:
        self.validate_replacement(expected_revision, messages)
        self._messages = tuple(messages)
        self._revision += 1
        return self.snapshot()

    def _require_revision(self, expected_revision: int) -> None:
        _require_revision(expected_revision)
        if expected_revision != self._revision:
            raise StaleCompactRevisionError(
                f"stale compact revision {expected_revision}; current={self._revision}"
            )


async def prepare_compact(
    snapshot: CompactSnapshot,
    summarizer: CompactSummarizer,
    *,
    transaction_id: str,
    boundary_id: str,
    summary_id: str,
    retain_last: int,
    cancel: CancelSignal,
) -> CompactPlan:
    _require_identifier(transaction_id, "transaction id")
    _require_identifier(boundary_id, "boundary id")
    _require_identifier(summary_id, "summary id")
    if not isinstance(retain_last, int) or retain_last < 0:
        raise CompactInvariantError("retain_last must be a non-negative integer")
    cancel.throw_if_cancelled()
    _validate_messages(snapshot.messages)

    start = _retained_start_index(snapshot.messages, retain_last)
    retained = snapshot.messages[start:]
    summarized = snapshot.messages[:start]
    if not summarized:
        raise CompactInvariantError("compact requires at least one summarized message")

    summary = (await summarizer.summarize(summarized, cancel)).strip()
    cancel.throw_if_cancelled()
    if not summary:
        raise CompactInvariantError("summary must not be empty")

    boundary = CompactMessage(boundary_id, "compact-boundary", "Conversation compacted")
    summary_message = CompactMessage(summary_id, "compact-summary", summary)
    replacement = (boundary, summary_message, *retained)
    _validate_messages(replacement)
    provenance = CompactProvenance(
        transaction_id,
        snapshot.revision,
        tuple(message.id for message in snapshot.messages),
        tuple(message.id for message in retained),
        boundary_id,
        summary_id,
    )
    return CompactPlan(
        snapshot.revision,
        tuple(snapshot.messages),
        replacement,
        provenance,
    )


def commit_compact(
    owner: CompactConversationOwner,
    plan: CompactPlan,
    journal: InMemoryCompactJournal,
    cancel: CancelSignal,
) -> CompactSnapshot:
    cancel.throw_if_cancelled()
    _validate_plan(plan)
    owner.validate_replacement(plan.expected_revision, plan.replacement)

    journal.append(
        CompactJournalRecord(
            "prepared", plan.original, plan.replacement, plan.provenance
        )
    )
    cancel.throw_if_cancelled()

    owner.validate_replacement(plan.expected_revision, plan.replacement)
    journal.append(
        CompactJournalRecord(
            "committed", plan.original, plan.replacement, plan.provenance
        )
    )
    return owner.replace(plan.expected_revision, plan.replacement)


def recover_compact(
    fallback: CompactSnapshot,
    records: tuple[CompactJournalRecord, ...],
) -> CompactRecoveryResult:
    if not records:
        return _recovery_result(fallback, fallback, "fell_back", "no_record")

    latest = records[-1]
    original = CompactSnapshot(
        latest.provenance.source_revision, tuple(latest.original)
    )
    if latest.phase != "committed":
        return _recovery_result(
            original, original, "fell_back", "prepared_only", latest
        )

    reason = _validate_recovery_record(latest)
    if reason is not None:
        return _recovery_result(
            original, original, "repair_required", reason, latest
        )

    restored = CompactSnapshot(
        latest.provenance.source_revision + 1,
        tuple(latest.replacement),
    )
    return _recovery_result(original, restored, "restored", None, latest)


def _retained_start_index(
    messages: tuple[CompactMessage, ...], retain_last: int
) -> int:
    start = max(0, len(messages) - retain_last)
    while (
        start > 0
        and messages[start].kind == "tool-result"
        and messages[start - 1].kind == "tool-use"
        and messages[start].tool_use_id == messages[start - 1].tool_use_id
    ):
        start -= 1
    return start


def _validate_plan(plan: CompactPlan) -> None:
    _require_revision(plan.expected_revision)
    _validate_messages(plan.original)
    _validate_messages(plan.replacement)
    if plan.provenance.source_revision != plan.expected_revision:
        raise CompactInvariantError("plan provenance revision mismatch")
    if tuple(message.id for message in plan.original) != plan.provenance.source_message_ids:
        raise CompactInvariantError("plan source provenance mismatch")
    reason = _validate_recovery_record(
        CompactJournalRecord(
            "committed", plan.original, plan.replacement, plan.provenance
        )
    )
    if reason is not None:
        raise CompactInvariantError(reason)


def _validate_recovery_record(
    record: CompactJournalRecord,
) -> Literal[
    "missing_boundary", "missing_summary", "malformed_provenance"
] | None:
    try:
        _validate_messages(record.original)
        _validate_messages(record.replacement)
    except CompactInvariantError:
        return "malformed_provenance"

    boundary = next(
        (item for item in record.replacement if item.id == record.provenance.boundary_id),
        None,
    )
    if boundary is None or boundary.kind != "compact-boundary":
        return "missing_boundary"
    summary = next(
        (item for item in record.replacement if item.id == record.provenance.summary_id),
        None,
    )
    if summary is None or summary.kind != "compact-summary":
        return "missing_summary"
    if tuple(item.id for item in record.original) != record.provenance.source_message_ids:
        return "malformed_provenance"
    replacement_ids = {item.id for item in record.replacement}
    if any(item not in replacement_ids for item in record.provenance.retained_message_ids):
        return "malformed_provenance"
    return None


def _validate_messages(messages: tuple[CompactMessage, ...]) -> None:
    ids: set[str] = set()
    pending: str | None = None
    for message in messages:
        _require_identifier(message.id, "message id")
        if message.id in ids:
            raise CompactInvariantError(f"duplicate id: {message.id}")
        ids.add(message.id)
        if not message.content.strip():
            raise CompactInvariantError(f"empty content: {message.id}")

        if message.kind == "tool-use":
            if pending is not None:
                raise CompactInvariantError("nested unresolved tool use")
            _require_identifier(message.tool_use_id or "", "tool use id")
            pending = message.tool_use_id
        elif message.kind == "tool-result":
            if pending is None or message.tool_use_id != pending:
                raise CompactInvariantError(
                    f"orphan tool result: {message.tool_use_id or ''}"
                )
            pending = None
        elif pending is not None:
            raise CompactInvariantError(f"missing tool result: {pending}")
    if pending is not None:
        raise CompactInvariantError(f"missing tool result: {pending}")


def _recovery_result(
    source: CompactSnapshot,
    restored: CompactSnapshot,
    status: Literal["restored", "fell_back", "repair_required"],
    reason,
    record: CompactJournalRecord | None = None,
) -> CompactRecoveryResult:
    return CompactRecoveryResult(
        restored,
        CompactRecoveryReport(
            status=status,
            source_revision=source.revision,
            source_count=len(source.messages),
            restored_count=len(restored.messages),
            transaction_id=(record.provenance.transaction_id if record else None),
            target_revision=(restored.revision if status == "restored" else None),
            reason=reason,
        ),
    )


def _require_identifier(value: str, name: str) -> None:
    if not value.strip():
        raise CompactInvariantError(f"{name} must not be empty")


def _require_revision(value: int) -> None:
    if not isinstance(value, int) or value < 0:
        raise CompactInvariantError("revision must be a non-negative integer")

