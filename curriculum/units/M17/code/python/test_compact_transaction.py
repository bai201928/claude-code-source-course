from __future__ import annotations

import json
import unittest

from compact_transaction import (
    CancelSignal,
    CompactCancelledError,
    CompactConversationOwner,
    CompactJournalRecord,
    CompactMessage,
    InMemoryCompactJournal,
    StaleCompactRevisionError,
    commit_compact,
    prepare_compact,
    recover_compact,
)


def messages() -> tuple[CompactMessage, ...]:
    return (
        CompactMessage("h-1", "human", "inspect the repository"),
        CompactMessage("a-1", "assistant", "I will read it"),
        CompactMessage("tu-1", "tool-use", "read", "call-1"),
        CompactMessage("tr-1", "tool-result", "large result", "call-1"),
        CompactMessage("a-2", "assistant", "the result means X"),
    )


class Summarizer:
    async def summarize(self, source, cancel):
        return "summary of " + ",".join(item.id for item in source)


async def make_plan(owner: CompactConversationOwner, retain_last: int = 1):
    return await prepare_compact(
        owner.snapshot(),
        Summarizer(),
        transaction_id="tx-1",
        boundary_id="boundary-1",
        summary_id="summary-1",
        retain_last=retain_last,
        cancel=CancelSignal(),
    )


class CompactTransactionTests(unittest.IsolatedAsyncioTestCase):
    async def test_summary_cancellation_leaves_owner_unchanged(self) -> None:
        owner = CompactConversationOwner(messages(), 3)
        before = owner.snapshot()
        cancel = CancelSignal()

        class Cancelling:
            async def summarize(self, source, inner_cancel):
                inner_cancel.cancel()
                return "late summary"

        with self.assertRaises(CompactCancelledError):
            await prepare_compact(
                before,
                Cancelling(),
                transaction_id="tx-cancel",
                boundary_id="b-cancel",
                summary_id="s-cancel",
                retain_last=1,
                cancel=cancel,
            )
        self.assertEqual(owner.snapshot(), before)

    async def test_cancel_after_prepared_record_falls_back(self) -> None:
        owner = CompactConversationOwner(messages(), 4)
        before = owner.snapshot()
        plan = await make_plan(owner)
        cancel = CancelSignal()
        journal = InMemoryCompactJournal(
            lambda record: cancel.cancel() if record.phase == "prepared" else None
        )
        with self.assertRaises(CompactCancelledError):
            commit_compact(owner, plan, journal, cancel)
        self.assertEqual(owner.snapshot(), before)
        recovered = recover_compact(before, journal.records())
        self.assertEqual(recovered.report.status, "fell_back")
        self.assertEqual(recovered.report.reason, "prepared_only")

    async def test_stale_plan_is_rejected_before_journal_mutation(self) -> None:
        owner = CompactConversationOwner(messages(), 2)
        plan = await make_plan(owner)
        owner.append(2, (CompactMessage("h-late", "human", "new fact"),))
        journal = InMemoryCompactJournal()
        with self.assertRaises(StaleCompactRevisionError):
            commit_compact(owner, plan, journal, CancelSignal())
        self.assertEqual(journal.records(), ())
        self.assertEqual(owner.snapshot().messages[-1].id, "h-late")

    async def test_complete_commit_and_recovery_are_stable(self) -> None:
        owner = CompactConversationOwner(messages(), 7)
        plan = await make_plan(owner)
        journal = InMemoryCompactJournal()
        committed = commit_compact(owner, plan, journal, CancelSignal())
        self.assertEqual(committed.revision, 8)
        self.assertEqual(
            tuple(item.kind for item in committed.messages),
            ("compact-boundary", "compact-summary", "assistant"),
        )
        recovered = recover_compact(owner.snapshot(), journal.records())
        self.assertEqual(recovered.report.status, "restored")
        self.assertEqual(recovered.snapshot, committed)

    async def test_retained_boundary_preserves_tool_pair(self) -> None:
        owner = CompactConversationOwner(messages(), 1)
        plan = await make_plan(owner, 2)
        self.assertEqual(
            plan.provenance.retained_message_ids,
            ("tu-1", "tr-1", "a-2"),
        )

    async def test_boundary_only_falls_back_with_repair_report(self) -> None:
        owner = CompactConversationOwner(messages(), 5)
        plan = await make_plan(owner)
        record = CompactJournalRecord(
            "committed",
            plan.original,
            tuple(item for item in plan.replacement if item.kind != "compact-summary"),
            plan.provenance,
        )
        result = recover_compact(owner.snapshot(), (record,))
        self.assertEqual(result.report.status, "repair_required")
        self.assertEqual(result.report.reason, "missing_summary")
        self.assertEqual(result.snapshot, owner.snapshot())

    async def test_summary_only_falls_back_with_repair_report(self) -> None:
        owner = CompactConversationOwner(messages(), 5)
        plan = await make_plan(owner)
        record = CompactJournalRecord(
            "committed",
            plan.original,
            tuple(item for item in plan.replacement if item.kind != "compact-boundary"),
            plan.provenance,
        )
        result = recover_compact(owner.snapshot(), (record,))
        self.assertEqual(result.report.status, "repair_required")
        self.assertEqual(result.report.reason, "missing_boundary")

    async def test_malformed_provenance_report_has_no_content(self) -> None:
        owner = CompactConversationOwner(messages(), 5)
        plan = await make_plan(owner)
        bad = plan.provenance.__class__(
            plan.provenance.transaction_id,
            plan.provenance.source_revision,
            ("wrong",),
            plan.provenance.retained_message_ids,
            plan.provenance.boundary_id,
            plan.provenance.summary_id,
        )
        record = CompactJournalRecord(
            "committed", plan.original, plan.replacement, bad
        )
        result = recover_compact(owner.snapshot(), (record,))
        self.assertEqual(result.report.status, "repair_required")
        self.assertEqual(result.report.reason, "malformed_provenance")
        serialized = json.dumps(result.report.__dict__)
        self.assertNotIn("large result", serialized)
        self.assertNotIn("summary of", serialized)


if __name__ == "__main__":
    unittest.main()
