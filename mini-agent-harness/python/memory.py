from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable, Literal

MemoryStatus = Literal["candidate", "accepted", "rejected", "superseded", "expired"]
MemoryScopeKind = Literal["project", "session"]
SourceKind = Literal["user", "assistant", "tool", "system"]


@dataclass(frozen=True)
class MemoryScope:
    kind: MemoryScopeKind
    key: str


@dataclass(frozen=True)
class MemoryProvenance:
    source_kind: SourceKind
    source_ids: tuple[str, ...]
    captured_at: float


@dataclass(frozen=True)
class MemoryRecord:
    id: str
    key: str
    content: str
    scope: MemoryScope
    provenance: MemoryProvenance
    status: MemoryStatus
    created_at: float
    updated_at: float
    retention_ms: int | None = None
    expires_at: float | None = None


@dataclass(frozen=True)
class MemorySnapshot:
    revision: int
    records: tuple[MemoryRecord, ...]


@dataclass(frozen=True)
class MemoryTrace:
    operation: Literal["propose", "transition", "update", "expire", "merge"]
    status: Literal["committed", "rejected", "published"]
    revision: int
    memory_ids: tuple[str, ...]
    scope: MemoryScope
    reason: str | None = None


@dataclass(frozen=True)
class MemoryCandidateInput:
    id: str
    key: str
    content: str
    scope: MemoryScope
    provenance: MemoryProvenance
    retention_ms: int | None = None
    now_ms: float | None = None


@dataclass(frozen=True)
class MemoryRecallItem:
    record: MemoryRecord
    score: int
    content: str
    truncated: bool


@dataclass(frozen=True)
class MemoryProjectionReport:
    selected_count: int
    omitted_count: int
    chars: int
    bounded: bool


@dataclass(frozen=True)
class MemoryProjection:
    scope: MemoryScope
    query: str
    items: tuple[MemoryRecallItem, ...]
    text: str
    report: MemoryProjectionReport


class MemoryInvariantError(ValueError):
    pass


class MemoryRevisionConflictError(RuntimeError):
    pass


class MemoryTransitionError(RuntimeError):
    pass


class MemoryStore:
    def __init__(self, clock: Callable[[], float] | None = None) -> None:
        self._revision = 0
        self._records: dict[str, MemoryRecord] = {}
        self._traces: list[MemoryTrace] = []
        self._clock = clock or (lambda: __import__("time").time() * 1000)

    @property
    def revision(self) -> int:
        return self._revision

    def snapshot(self) -> MemorySnapshot:
        return MemorySnapshot(
            self._revision,
            tuple(self._records[key] for key in sorted(self._records)),
        )

    def traces(self) -> tuple[MemoryTrace, ...]:
        return tuple(self._traces)

    def propose(self, expected_revision: int, candidate: MemoryCandidateInput) -> MemorySnapshot:
        self._require_revision(expected_revision, "propose")
        _validate_candidate(candidate)
        duplicate = next(
            (
                item
                for item in self._records.values()
                if item.key == candidate.key
                and item.scope == candidate.scope
                and item.status in ("candidate", "accepted")
            ),
            None,
        )
        if duplicate is not None:
            self._traces.append(_trace("merge", "committed", self._revision, (duplicate.id,), candidate.scope))
            return self.snapshot()
        if candidate.id in self._records:
            raise MemoryInvariantError(f"duplicate memory id: {candidate.id}")
        now = candidate.now_ms if candidate.now_ms is not None else self._now()
        record = MemoryRecord(
            candidate.id,
            candidate.key,
            candidate.content,
            candidate.scope,
            candidate.provenance,
            "candidate",
            now,
            now,
            candidate.retention_ms,
        )
        self._records[record.id] = record
        self._revision += 1
        self._traces.append(_trace("propose", "committed", self._revision, (record.id,), record.scope))
        return self.snapshot()

    def transition(
        self,
        expected_revision: int,
        identifier: str,
        status: Literal["accepted", "rejected", "superseded", "expired"],
        *,
        superseded_by: str | None = None,
        now_ms: float | None = None,
        retention_ms: int | None = None,
    ) -> MemorySnapshot:
        self._require_revision(expected_revision, "transition")
        current = self._require_record(identifier)
        now = self._now() if now_ms is None else now_ms
        if not _valid_transition(current.status, status):
            raise MemoryTransitionError(f"cannot transition {current.status} -> {status}")
        if status == "superseded":
            if not superseded_by or superseded_by == identifier:
                raise MemoryTransitionError("superseded memory requires a different replacement id")
            replacement = self._require_record(superseded_by)
            if replacement.status not in ("candidate", "accepted"):
                raise MemoryTransitionError("replacement memory must be candidate or accepted")
        effective_retention = current.retention_ms if retention_ms is None else retention_ms
        if effective_retention is not None and (isinstance(effective_retention, bool) or effective_retention < 0):
            raise MemoryInvariantError("retention_ms must be a non-negative integer")
        expires = now + effective_retention if status == "accepted" and effective_retention is not None else None
        self._records[identifier] = replace(
            current,
            status=status,
            updated_at=now,
            retention_ms=effective_retention,
            expires_at=expires,
        )
        self._revision += 1
        self._traces.append(_trace("transition", "committed", self._revision, (identifier,), current.scope))
        return self.snapshot()

    def update_accepted(
        self,
        expected_revision: int,
        identifier: str,
        *,
        content: str,
        provenance: MemoryProvenance,
        now_ms: float | None = None,
        retention_ms: int | None = None,
    ) -> MemorySnapshot:
        self._require_revision(expected_revision, "update")
        current = self._require_record(identifier)
        if current.status != "accepted":
            raise MemoryTransitionError("only accepted memories can be updated")
        _validate_provenance(provenance)
        _require_text(content, "memory content")
        effective_retention = current.retention_ms if retention_ms is None else retention_ms
        if effective_retention is not None and (isinstance(effective_retention, bool) or effective_retention < 0):
            raise MemoryInvariantError("retention_ms must be a non-negative integer")
        now = self._now() if now_ms is None else now_ms
        self._records[identifier] = replace(
            current,
            content=content,
            provenance=provenance,
            updated_at=now,
            retention_ms=effective_retention,
            expires_at=now + effective_retention if effective_retention is not None else None,
        )
        self._revision += 1
        self._traces.append(_trace("update", "committed", self._revision, (identifier,), current.scope))
        return self.snapshot()

    def expire(self, expected_revision: int, now_ms: float | None = None) -> MemorySnapshot:
        self._require_revision(expected_revision, "expire")
        now = self._now() if now_ms is None else now_ms
        expired: list[MemoryRecord] = []
        for identifier, record in tuple(self._records.items()):
            if record.status == "accepted" and record.expires_at is not None and record.expires_at <= now:
                updated = replace(record, status="expired", updated_at=now, expires_at=None)
                self._records[identifier] = updated
                expired.append(updated)
        if expired:
            self._revision += 1
            self._traces.append(_trace("expire", "committed", self._revision, tuple(item.id for item in expired), expired[0].scope))
        return self.snapshot()

    def recall(
        self,
        scope: MemoryScope,
        query: str,
        *,
        limit: int = 5,
        max_chars: int = 4000,
        now_ms: float | None = None,
    ) -> tuple[MemoryRecallItem, ...]:
        _validate_scope(scope)
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
            raise MemoryInvariantError("recall limit must be a non-negative integer")
        if isinstance(max_chars, bool) or not isinstance(max_chars, int) or max_chars < 0:
            raise MemoryInvariantError("recall max_chars must be a non-negative integer")
        now = self._now() if now_ms is None else now_ms
        terms = _tokenize(query)
        ranked = sorted(
            (
                (record, _score(record, terms))
                for record in self._records.values()
                if record.status == "accepted"
                and record.scope == scope
                and (record.expires_at is None or record.expires_at > now)
            ),
            key=lambda item: (-item[1], -item[0].updated_at, item[0].id),
        )
        output: list[MemoryRecallItem] = []
        remaining = max_chars
        for record, score in ranked:
            if len(output) >= limit or remaining <= 0:
                break
            content = record.content[:remaining]
            if not content:
                break
            output.append(MemoryRecallItem(record, score, content, len(content) < len(record.content)))
            remaining -= len(content)
        return tuple(output)

    def _require_record(self, identifier: str) -> MemoryRecord:
        _require_text(identifier, "memory id")
        if identifier not in self._records:
            raise MemoryInvariantError(f"unknown memory id: {identifier}")
        return self._records[identifier]

    def _require_revision(self, expected: int, operation: str) -> None:
        if isinstance(expected, bool) or expected != self._revision:
            error = MemoryRevisionConflictError(
                f"stale memory {operation}: expected={expected}; current={self._revision}"
            )
            operation_name = operation if operation in ("propose", "update", "expire") else "transition"
            self._traces.append(_trace(operation_name, "rejected", self._revision, (), MemoryScope("session", "unknown"), str(error)))
            raise error

    def _now(self) -> float:
        return float(self._clock())


class MemoryProjector:
    def __init__(self, store: MemoryStore) -> None:
        self._store = store

    def project(
        self,
        scope: MemoryScope,
        query: str,
        *,
        limit: int = 5,
        max_chars: int = 4000,
        now_ms: float | None = None,
    ) -> MemoryProjection:
        items = self._store.recall(scope, query, limit=limit, max_chars=max_chars, now_ms=now_ms)
        text = "\n".join(f"- {item.record.key}: {item.content}" for item in items)
        all_items = self._store.recall(scope, query, now_ms=now_ms)
        return MemoryProjection(
            scope,
            query,
            items,
            text,
            MemoryProjectionReport(len(items), max(0, len(all_items) - len(items)), len(text), limit != 5 or max_chars != 4000),
        )


def _valid_transition(current: MemoryStatus, target: MemoryStatus) -> bool:
    return (current == "candidate" and target in ("accepted", "rejected", "superseded")) or (
        current == "accepted" and target in ("superseded", "expired")
    )


def _score(record: MemoryRecord, terms: tuple[str, ...]) -> int:
    if not terms:
        return 0
    haystack = f"{record.key} {record.content}".lower()
    return sum(1 for term in terms if term in haystack)


def _tokenize(value: str) -> tuple[str, ...]:
    import re

    return tuple(item for item in re.split(r"[^a-z0-9_\u4e00-\u9fff]+", value.lower()) if item)


def _trace(operation, status, revision, memory_ids, scope, reason=None) -> MemoryTrace:
    return MemoryTrace(operation, status, revision, tuple(memory_ids), scope, reason)


def _validate_candidate(candidate: MemoryCandidateInput) -> None:
    _require_text(candidate.id, "memory id")
    _require_text(candidate.key, "memory key")
    _require_text(candidate.content, "memory content")
    _validate_scope(candidate.scope)
    _validate_provenance(candidate.provenance)
    if candidate.retention_ms is not None and (isinstance(candidate.retention_ms, bool) or candidate.retention_ms < 0):
        raise MemoryInvariantError("retention_ms must be a non-negative integer")


def _validate_scope(scope: MemoryScope) -> None:
    if scope.kind not in ("project", "session"):
        raise MemoryInvariantError("memory scope kind is invalid")
    _require_text(scope.key, "memory scope key")


def _validate_provenance(provenance: MemoryProvenance) -> None:
    if provenance.source_kind not in ("user", "assistant", "tool", "system"):
        raise MemoryInvariantError("memory provenance source_kind is invalid")
    if not provenance.source_ids or any(not item.strip() for item in provenance.source_ids):
        raise MemoryInvariantError("memory provenance requires source ids")
    if not isinstance(provenance.captured_at, (int, float)):
        raise MemoryInvariantError("memory provenance captured_at is invalid")


def _require_text(value: str, label: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise MemoryInvariantError(f"{label} must not be empty")
