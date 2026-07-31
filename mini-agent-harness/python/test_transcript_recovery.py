import json
import unittest

from transcript_recovery import (
    RecoveryReducer,
    ResumeCoordinator,
    TranscriptStore,
    decode_transcript_jsonl,
    encode_transcript_jsonl,
)
from work_coordinator import DurableScheduler


def message(record_id, message_id, parent_id, sequence, **extra):
    record = {
        "schemaVersion": 1,
        "type": "message",
        "recordId": record_id,
        "sessionId": "s1",
        "sequence": sequence,
        "messageId": message_id,
        "parentMessageId": parent_id,
        "role": "user",
    }
    record.update(extra)
    return record


class TranscriptRecoveryTests(unittest.TestCase):
    def test_record_dedupe_and_revision(self):
        store = TranscriptStore()
        first = message("r1", "m1", None, 1)
        store.append(first)
        store.append(first)
        self.assertEqual(store.revision, 1)
        with self.assertRaisesRegex(ValueError, "stale transcript revision"):
            store.append(message("r2", "m2", "m1", 2), expected_revision=0)

    def test_partial_tail_and_malformed_middle(self):
        valid = json.dumps(message("r1", "m1", None, 1), separators=(",", ":"))
        store, report = decode_transcript_jsonl(f"{valid}\nnot-json\n{{\"schemaVersion\":1")
        self.assertEqual(report.accepted_records, 1)
        self.assertEqual(report.malformed_line_numbers, (2,))
        self.assertTrue(report.partial_tail_ignored)
        self.assertEqual(encode_transcript_jsonl(store.export_state()), f"{valid}\n")

    def test_dangling_and_cycle_are_visible(self):
        dangling = TranscriptStore()
        dangling.append(message("r1", "m2", "missing", 1))
        snapshot = RecoveryReducer().reduce(dangling, "s1")
        self.assertEqual(snapshot.report.dangling_parent_ids, ("missing",))
        self.assertFalse(snapshot.report.complete_chain)

        cycle = TranscriptStore()
        cycle.append(message("r1", "m1", "m2", 1))
        cycle.append(message("r2", "m2", "m1", 2))
        snapshot = RecoveryReducer().reduce(cycle, "s1", leaf_message_id="m2")
        self.assertEqual(snapshot.report.cycle_message_ids, ("m2",))

    def test_parallel_sibling_and_result_recovery(self):
        store = TranscriptStore()
        store.append(message("r1", "u1", None, 1))
        store.append(message("r2", "a1", "u1", 2, role="assistant", parallelGroupId="p1", toolUseIds=["t1"]))
        store.append(message("r3", "a2", "a1", 3, role="assistant", parallelGroupId="p1", toolUseIds=["t2"]))
        store.append(message("r4", "tr1", "a1", 4, role="tool", sourceAssistantMessageId="a1", toolResultIds=["t1"]))
        store.append(message("r5", "tr2", "a2", 5, role="tool", sourceAssistantMessageId="a2", toolResultIds=["t2"]))
        store.append(message("r6", "u2", "tr1", 6))
        snapshot = RecoveryReducer().reduce(store, "s1", leaf_message_id="u2")
        self.assertEqual(snapshot.report.recovered_parallel_message_ids, ("a2", "tr2"))

    def test_unresolved_filter_and_metadata_only_report(self):
        store = TranscriptStore()
        store.append(message("r1", "u1", None, 1, content="secret-prompt"))
        store.append(message("r2", "a1", "u1", 2, role="assistant", content="secret-text", toolUseIds=["t1"]))
        snapshot = RecoveryReducer().reduce(store, "s1")
        self.assertEqual([item["messageId"] for item in snapshot.messages], ["u1"])
        self.assertEqual(snapshot.report.unresolved_tool_use_ids, ("t1",))
        self.assertNotIn("secret", repr(snapshot.report))

    def test_effect_and_background_recovery(self):
        store = TranscriptStore()
        store.append({"schemaVersion": 1, "type": "effect", "recordId": "e1", "sessionId": "s1", "sequence": 1, "effectId": "prepared", "toolUseId": "t1", "idempotencyKey": "k1", "phase": "prepared"})
        store.append({"schemaVersion": 1, "type": "effect", "recordId": "e2", "sessionId": "s1", "sequence": 2, "effectId": "unknown", "toolUseId": "t2", "idempotencyKey": "k2", "phase": "attempted"})
        store.append({"schemaVersion": 1, "type": "effect", "recordId": "e3", "sessionId": "s1", "sequence": 3, "effectId": "done", "toolUseId": "t3", "idempotencyKey": "k3", "phase": "committed"})
        store.append({"schemaVersion": 1, "type": "background", "recordId": "b1", "sessionId": "s1", "sequence": 4, "executionId": "x1", "attempt": 1, "phase": "started", "restartPolicy": "manual"})
        snapshot = RecoveryReducer().reduce(store, "s1")
        self.assertEqual(snapshot.report.prepared_effect_ids, ("prepared",))
        self.assertEqual(snapshot.report.indeterminate_effect_ids, ("unknown",))
        self.assertEqual(snapshot.report.committed_effect_ids, ("done",))
        self.assertEqual(snapshot.report.orphaned_execution_ids, ("x1",))

    def test_normal_fork_and_scheduler_takeover(self):
        store = TranscriptStore()
        store.append(message("r1", "m1", None, 1))
        store.append({"schemaVersion": 1, "type": "background", "recordId": "b1", "sessionId": "s1", "sequence": 2, "executionId": "x1", "attempt": 1, "phase": "started", "restartPolicy": "manual"})
        scheduler = DurableScheduler()
        scheduler.schedule(schedule_id="cron-1", work_item_id="work-1", next_run_at=10)
        trigger = scheduler.poll(10)[0]
        ids = iter(("fork-session", "fork-message", "fork-session-record", "fork-message-record"))
        coordinator = ResumeCoordinator(store, lambda: next(ids))
        normal = coordinator.resume("s1", "normal", scheduler_state=scheduler.export_state())
        fork = coordinator.resume("s1", "fork")
        self.assertEqual(normal.session_id, "s1")
        self.assertEqual(normal.report.pending_trigger_ids, (trigger.trigger_id,))
        self.assertEqual(fork.session_id, "fork-session")
        self.assertEqual(fork.messages[0]["sourceMessageId"], "m1")
        self.assertNotEqual(fork.messages[0]["messageId"], "m1")
        self.assertEqual(fork.report.orphaned_execution_ids, ())


if __name__ == "__main__":
    unittest.main()
