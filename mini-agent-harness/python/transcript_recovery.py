from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any, Callable, Iterable

from work_coordinator import DurableScheduler, DurableSchedulerState


TranscriptRecord = dict[str, Any]


@dataclass(frozen=True)
class JsonlRecoveryReport:
    accepted_records: int
    malformed_line_numbers: tuple[int, ...]
    partial_tail_ignored: bool


@dataclass(frozen=True)
class EffectRecovery:
    effect_id: str
    tool_use_id: str
    idempotency_key: str
    status: str


@dataclass(frozen=True)
class RecoveryReport:
    session_id: str
    store_revision: int
    loaded_record_count: int
    restored_message_count: int
    complete_chain: bool
    duplicate_message_ids: tuple[str, ...]
    cycle_message_ids: tuple[str, ...]
    dangling_parent_ids: tuple[str, ...]
    recovered_parallel_message_ids: tuple[str, ...]
    unresolved_tool_use_ids: tuple[str, ...]
    prepared_effect_ids: tuple[str, ...]
    indeterminate_effect_ids: tuple[str, ...]
    committed_effect_ids: tuple[str, ...]
    orphaned_execution_ids: tuple[str, ...]
    pending_trigger_ids: tuple[str, ...]


@dataclass(frozen=True)
class RecoverySnapshot:
    messages: tuple[TranscriptRecord, ...]
    effects: tuple[EffectRecovery, ...]
    orphaned_executions: tuple[TranscriptRecord, ...]
    report: RecoveryReport


@dataclass(frozen=True)
class ResumeResult(RecoverySnapshot):
    mode: str
    session_id: str
    scheduler_state: DurableSchedulerState | None = None


class TranscriptStore:
    def __init__(self, state: dict[str, Any] | None = None) -> None:
        self._records: list[TranscriptRecord] = []
        self._by_record_id: dict[str, TranscriptRecord] = {}
        self._revision = 0
        if state:
            for record in state.get("records", []):
                self.append(record)
            self._revision = int(state["revision"])

    @property
    def revision(self) -> int:
        return self._revision

    def append(self, record: TranscriptRecord, expected_revision: int | None = None) -> TranscriptRecord:
        expected = self._revision if expected_revision is None else expected_revision
        if expected != self._revision:
            raise ValueError(f"stale transcript revision: expected {expected}, actual {self._revision}")
        normalized = _normalize_record(record)
        existing = self._by_record_id.get(normalized["recordId"])
        if existing is not None:
            if _stable_json(existing) != _stable_json(normalized):
                raise ValueError(f"record id collision: {normalized['recordId']}")
            return existing
        self._records.append(normalized)
        self._by_record_id[normalized["recordId"]] = normalized
        self._revision += 1
        return normalized

    def records_for_session(self, session_id: str) -> tuple[TranscriptRecord, ...]:
        return tuple(record for record in self._records if record["sessionId"] == session_id)

    def export_state(self) -> dict[str, Any]:
        return {"revision": self._revision, "records": tuple(dict(record) for record in self._records)}


def encode_transcript_jsonl(state: dict[str, Any]) -> str:
    records = state.get("records", ())
    return "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in records)


def decode_transcript_jsonl(data: str) -> tuple[TranscriptStore, JsonlRecoveryReport]:
    store = TranscriptStore()
    malformed: list[int] = []
    lines = data.split("\n")
    terminal_newline = data.endswith("\n")
    partial_tail = False
    for index, raw in enumerate(lines):
        if not raw.strip():
            continue
        try:
            parsed = json.loads(raw)
            if not _is_transcript_record(parsed):
                raise ValueError("invalid transcript record")
            store.append(parsed)
        except (json.JSONDecodeError, TypeError, ValueError):
            is_partial_tail = index == len(lines) - 1 and not terminal_newline
            if is_partial_tail:
                partial_tail = True
            else:
                malformed.append(index + 1)
    return store, JsonlRecoveryReport(store.revision, tuple(malformed), partial_tail)


class RecoveryReducer:
    def reduce(
        self,
        store: TranscriptStore,
        session_id: str,
        *,
        leaf_message_id: str | None = None,
        pending_trigger_ids: Iterable[str] = (),
    ) -> RecoverySnapshot:
        records = store.records_for_session(session_id)
        messages = [record for record in records if record["type"] == "message"]
        by_message_id: dict[str, TranscriptRecord] = {}
        duplicate_ids: set[str] = set()
        for message in messages:
            message_id = message["messageId"]
            if message_id in by_message_id:
                duplicate_ids.add(message_id)
                continue
            by_message_id[message_id] = message

        parent_ids = {message["parentMessageId"] for message in by_message_id.values() if message["parentMessageId"]}
        leaves = [message for message in by_message_id.values() if message["messageId"] not in parent_ids]
        leaf = by_message_id.get(leaf_message_id) if leaf_message_id else _latest(leaves or list(by_message_id.values()))
        reverse_chain: list[TranscriptRecord] = []
        seen: set[str] = set()
        cycles: set[str] = set()
        dangling: set[str] = set()
        current = leaf
        while current is not None:
            message_id = current["messageId"]
            if message_id in seen:
                cycles.add(message_id)
                break
            seen.add(message_id)
            reverse_chain.append(current)
            parent_id = current["parentMessageId"]
            if parent_id is None:
                break
            parent = by_message_id.get(parent_id)
            if parent is None:
                dangling.add(parent_id)
                break
            current = parent
        reverse_chain.reverse()

        recovered_ids: set[str] = set()
        expanded = _recover_parallel(reverse_chain, list(by_message_id.values()), recovered_ids)
        result_ids = {result_id for message in expanded for result_id in message.get("toolResultIds", ())}
        unresolved_ids: set[str] = set()
        filtered: list[TranscriptRecord] = []
        for message in expanded:
            uses = tuple(message.get("toolUseIds", ()))
            if message["role"] == "assistant" and uses:
                unresolved = [tool_id for tool_id in uses if tool_id not in result_ids]
                unresolved_ids.update(unresolved)
                if len(unresolved) == len(uses):
                    continue
            filtered.append(message)

        effects = _reduce_effects(records)
        orphaned = _reduce_background(records)
        report = RecoveryReport(
            session_id=session_id,
            store_revision=store.revision,
            loaded_record_count=len(records),
            restored_message_count=len(filtered),
            complete_chain=not cycles and not dangling,
            duplicate_message_ids=_sorted(duplicate_ids),
            cycle_message_ids=_sorted(cycles),
            dangling_parent_ids=_sorted(dangling),
            recovered_parallel_message_ids=_sorted(recovered_ids),
            unresolved_tool_use_ids=_sorted(unresolved_ids),
            prepared_effect_ids=_sorted(effect.effect_id for effect in effects if effect.status == "prepared"),
            indeterminate_effect_ids=_sorted(effect.effect_id for effect in effects if effect.status == "indeterminate"),
            committed_effect_ids=_sorted(effect.effect_id for effect in effects if effect.status == "committed"),
            orphaned_execution_ids=_sorted(record["executionId"] for record in orphaned),
            pending_trigger_ids=_sorted(pending_trigger_ids),
        )
        return RecoverySnapshot(tuple(filtered), tuple(effects), tuple(orphaned), report)


class ResumeCoordinator:
    def __init__(self, store: TranscriptStore, next_id: Callable[[], str]) -> None:
        self._store = store
        self._next_id = next_id
        self._reducer = RecoveryReducer()

    def resume(
        self,
        session_id: str,
        mode: str,
        *,
        leaf_message_id: str | None = None,
        scheduler_state: DurableSchedulerState | None = None,
    ) -> ResumeResult:
        restored_scheduler = DurableScheduler(state=scheduler_state).export_state() if scheduler_state else None
        pending_ids = tuple(trigger.trigger_id for trigger in restored_scheduler.pending) if restored_scheduler else ()
        source = self._reducer.reduce(
            self._store,
            session_id,
            leaf_message_id=leaf_message_id,
            pending_trigger_ids=pending_ids,
        )
        if mode == "normal":
            return ResumeResult(**source.__dict__, mode=mode, session_id=session_id, scheduler_state=restored_scheduler)
        if mode != "fork":
            raise ValueError(f"unknown resume mode: {mode}")

        fork_session_id = self._next_id()
        message_ids = {message["messageId"]: self._next_id() for message in source.messages}
        self._store.append({
            "schemaVersion": 1,
            "type": "session",
            "recordId": self._next_id(),
            "sessionId": fork_session_id,
            "sequence": self._store.revision + 1,
            "event": "forked",
            "forkedFromSessionId": session_id,
        })
        for message in source.messages:
            clone = dict(message)
            clone.update({
                "recordId": self._next_id(),
                "sessionId": fork_session_id,
                "sequence": self._store.revision + 1,
                "sourceMessageId": message["messageId"],
                "messageId": message_ids[message["messageId"]],
                "parentMessageId": message_ids.get(message["parentMessageId"]),
            })
            if message.get("sourceAssistantMessageId"):
                clone["sourceAssistantMessageId"] = message_ids.get(message["sourceAssistantMessageId"])
            self._store.append(clone)
        fork = self._reducer.reduce(self._store, fork_session_id, pending_trigger_ids=pending_ids)
        return ResumeResult(**fork.__dict__, mode=mode, session_id=fork_session_id, scheduler_state=restored_scheduler)


def _recover_parallel(
    chain: list[TranscriptRecord],
    all_messages: list[TranscriptRecord],
    recovered_ids: set[str],
) -> list[TranscriptRecord]:
    chain_ids = {message["messageId"] for message in chain}
    result: list[TranscriptRecord] = []
    for message in chain:
        result.append(message)
        group = message.get("parallelGroupId")
        if message["role"] != "assistant" or not group:
            continue
        siblings = sorted(
            (
                candidate for candidate in all_messages
                if candidate["messageId"] != message["messageId"]
                and candidate.get("parallelGroupId") == group
                and candidate["role"] == "assistant"
                and candidate["messageId"] not in chain_ids
            ),
            key=lambda item: item["sequence"],
        )
        sibling_ids = {sibling["messageId"] for sibling in siblings}
        tool_results = sorted(
            (
                candidate for candidate in all_messages
                if candidate.get("sourceAssistantMessageId") in sibling_ids
            ),
            key=lambda item: item["sequence"],
        )
        for recovered in [*siblings, *tool_results]:
            if recovered["messageId"] in chain_ids:
                continue
            chain_ids.add(recovered["messageId"])
            recovered_ids.add(recovered["messageId"])
            result.append(recovered)
    return result


def _reduce_effects(records: tuple[TranscriptRecord, ...]) -> list[EffectRecovery]:
    latest: dict[str, TranscriptRecord] = {}
    for record in records:
        if record["type"] != "effect":
            continue
        current = latest.get(record["effectId"])
        if current is None or record["sequence"] > current["sequence"]:
            latest[record["effectId"]] = record
    result = []
    for record in sorted(latest.values(), key=lambda item: item["sequence"]):
        status = "indeterminate" if record["phase"] == "attempted" else record["phase"]
        result.append(EffectRecovery(record["effectId"], record["toolUseId"], record["idempotencyKey"], status))
    return result


def _reduce_background(records: tuple[TranscriptRecord, ...]) -> list[TranscriptRecord]:
    latest: dict[str, TranscriptRecord] = {}
    for record in records:
        if record["type"] != "background":
            continue
        current = latest.get(record["executionId"])
        if current is None or record["sequence"] > current["sequence"]:
            latest[record["executionId"]] = record
    return sorted(
        (record for record in latest.values() if record["phase"] in {"started", "heartbeat"}),
        key=lambda item: item["sequence"],
    )


def _latest(messages: list[TranscriptRecord]) -> TranscriptRecord | None:
    return max(messages, key=lambda item: item["sequence"], default=None)


def _normalize_record(record: TranscriptRecord) -> TranscriptRecord:
    if not _is_transcript_record(record):
        raise ValueError("invalid transcript record")
    normalized = dict(record)
    if record["type"] == "message":
        if "toolUseIds" in record:
            normalized["toolUseIds"] = tuple(record["toolUseIds"])
        if "toolResultIds" in record:
            normalized["toolResultIds"] = tuple(record["toolResultIds"])
    return normalized


def _is_transcript_record(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if value.get("schemaVersion") != 1 or not isinstance(value.get("recordId"), str) or not isinstance(value.get("sessionId"), str):
        return False
    if not isinstance(value.get("sequence"), int) or value["sequence"] < 0:
        return False
    record_type = value.get("type")
    if record_type == "message":
        return isinstance(value.get("messageId"), str) and (isinstance(value.get("parentMessageId"), str) or value.get("parentMessageId") is None) and value.get("role") in {"user", "assistant", "tool"}
    if record_type == "effect":
        return all(isinstance(value.get(key), str) for key in ("effectId", "toolUseId", "idempotencyKey")) and value.get("phase") in {"prepared", "attempted", "committed"}
    if record_type == "background":
        return isinstance(value.get("executionId"), str) and isinstance(value.get("attempt"), int) and value.get("phase") in {"started", "heartbeat", "completed", "failed"} and value.get("restartPolicy") in {"resume", "manual"}
    if record_type == "session":
        return value.get("event") in {"created", "forked"}
    return False


def _stable_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _sorted(values: Iterable[str]) -> tuple[str, ...]:
    return tuple(sorted(set(values)))
