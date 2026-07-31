import json
import unittest

from context_budget import (
    AggregateBudgetPolicy,
    ContextProjectionError,
    Envelope,
    ResultBudgetLedger,
    StaleReplacementRevisionError,
    ToolCall,
    apply_per_result_preview,
    assert_strict_pairing,
    naive_global_suffix,
    plan_aggregate_projection,
    project_and_commit,
    total_tool_result_chars,
)


def three_results() -> tuple[Envelope, ...]:
    return (
        Envelope(
            "assistant",
            response_id="response-1",
            calls=(
                ToolCall("a", "search"),
                ToolCall("b", "search"),
                ToolCall("c", "search"),
            ),
        ),
        Envelope("tool-result", call_id="a", content="A" * 80),
        Envelope("progress", call_id="b", text="halfway"),
        Envelope("tool-result", call_id="b", content="B" * 80),
        Envelope("attachment", text="workspace changed"),
        Envelope("assistant", response_id="response-1"),
        Envelope("tool-result", call_id="c", content="C" * 80),
    )


class ContextBudgetTests(unittest.TestCase):
    def test_naive_global_suffix_can_orphan_result(self) -> None:
        with self.assertRaises(ContextProjectionError):
            naive_global_suffix(three_results(), 170)

    def test_per_result_preview_misses_group_budget(self) -> None:
        projected = apply_per_result_preview(three_results(), 100, 8)
        self.assertEqual(total_tool_result_chars(projected), 240)

    def test_aggregate_is_copy_on_write_and_report_is_content_free(self) -> None:
        source = three_results()
        result = project_and_commit(
            source,
            ResultBudgetLedger(),
            AggregateBudgetPolicy(220, 4),
        )
        self.assertEqual(source, three_results())
        self.assertFalse(result.report.groups[0].over_budget)
        self.assertEqual(result.report.newly_replaced_count, 1)
        self.assertNotIn("AAAA", json.dumps(result.report.__dict__, default=str))
        assert_strict_pairing(result.messages)

    def test_replacement_is_stable(self) -> None:
        ledger = ResultBudgetLedger()
        policy = AggregateBudgetPolicy(220, 4)
        first = project_and_commit(three_results(), ledger, policy)
        second = project_and_commit(three_results(), ledger, policy)
        self.assertEqual(first.messages, second.messages)
        self.assertEqual(second.report.newly_replaced_count, 0)
        self.assertEqual(second.report.reapplied_count, 1)
        self.assertEqual(second.report.replacement_revision, 1)

    def test_non_boundary_envelopes_stay_in_one_group(self) -> None:
        result = project_and_commit(
            three_results(),
            ResultBudgetLedger(),
            AggregateBudgetPolicy(220, 4),
        )
        self.assertEqual(len(result.report.groups), 1)
        self.assertEqual(result.report.groups[0].result_count, 3)
        self.assertEqual(result.report.newly_replaced_count, 1)

    def test_self_bounded_result_can_remain_over_budget(self) -> None:
        source = (
            Envelope(
                "assistant",
                response_id="response-2",
                calls=(ToolCall("read", "read_file"),),
            ),
            Envelope(
                "tool-result",
                call_id="read",
                content="R" * 240,
                self_bounded=True,
            ),
        )
        result = project_and_commit(
            source,
            ResultBudgetLedger(),
            AggregateBudgetPolicy(100, 4),
        )
        self.assertEqual(result.report.newly_replaced_count, 0)
        self.assertEqual(result.report.groups[0].excluded_count, 1)
        self.assertTrue(result.report.groups[0].over_budget)

    def test_history_start_rejects_orphan(self) -> None:
        with self.assertRaisesRegex(ContextProjectionError, "orphan"):
            project_and_commit(
                three_results(),
                ResultBudgetLedger(),
                AggregateBudgetPolicy(200, 4, history_start=1),
            )

    def test_stale_writer_is_rejected(self) -> None:
        ledger = ResultBudgetLedger()
        snapshot = ledger.snapshot()
        first = plan_aggregate_projection(
            three_results(), snapshot, AggregateBudgetPolicy(190, 4)
        )
        stale = plan_aggregate_projection(
            three_results(), snapshot, AggregateBudgetPolicy(180, 2)
        )
        ledger.commit(first.ledger_commit)
        with self.assertRaises(StaleReplacementRevisionError):
            ledger.commit(stale.ledger_commit)


if __name__ == "__main__":
    unittest.main()
