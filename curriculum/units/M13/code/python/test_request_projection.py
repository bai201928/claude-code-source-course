from __future__ import annotations

import unittest

from request_projection import (
    ContentReplacementState,
    DomainMessage,
    ProjectionError,
    build_final_params,
    project_request,
)


def history() -> tuple[DomainMessage, ...]:
    return (
        DomainMessage("human", "u-old", "old question"),
        DomainMessage("compact-boundary", "b-1"),
        DomainMessage("human", "u-new", "inspect workspace"),
        DomainMessage(
            "assistant",
            "a-1",
            response_id="r-1",
            blocks=({"type": "tool_use", "id": "call-1", "name": "read", "input": {"path": "README.md"}},),
        ),
        DomainMessage("progress", "p-1", "reading"),
        DomainMessage("tool-result", "tr-1", "x" * 120, tool_use_id="call-1"),
        DomainMessage("attachment", "att-1", "branch=main"),
    )


class RequestProjectionTests(unittest.TestCase):
    def test_boundary_context_and_internal_messages_only_change_request_view(self) -> None:
        source = history()
        projected = project_request(source, user_context="cwd=/repo")
        rendered = repr(projected.messages)
        self.assertEqual(projected.report.omitted_before_boundary, 1)
        self.assertNotIn("old question", rendered)
        self.assertNotIn("reading", rendered)
        self.assertIn("cwd=/repo", rendered)
        self.assertIn("<system-reminder>", rendered)
        self.assertIn("branch=main", rendered)
        self.assertEqual(source, history())

    def test_budget_is_deterministic_and_preserves_full_source(self) -> None:
        first = project_request(history(), tool_result_budget_chars=40)
        second = project_request(history(), tool_result_budget_chars=40)
        self.assertEqual(first, second)
        self.assertEqual(first.report.replaced_tool_use_ids, ("call-1",))
        self.assertIn("omitted: 120 chars", repr(first.messages))
        self.assertEqual(history()[5].text, "x" * 120)

    def test_budget_follows_api_user_groups_instead_of_one_global_total(self) -> None:
        messages = (
            DomainMessage(
                "assistant", "a-1", response_id="r-1",
                blocks=({"type": "tool_use", "id": "call-1", "name": "read", "input": {}},),
            ),
            DomainMessage("tool-result", "tr-1", "a" * 80, tool_use_id="call-1"),
            DomainMessage(
                "assistant", "a-2", response_id="r-2",
                blocks=({"type": "tool_use", "id": "call-2", "name": "read", "input": {}},),
            ),
            DomainMessage("tool-result", "tr-2", "b" * 80, tool_use_id="call-2"),
        )
        projected = project_request(messages, tool_result_budget_chars=100)
        self.assertEqual(projected.report.replaced_tool_use_ids, ())

    def test_replacement_state_freezes_and_reapplies_preview_across_turns(self) -> None:
        state = ContentReplacementState()
        first = project_request(
            history(), tool_result_budget_chars=40, replacement_state=state
        )
        second = project_request(
            history(), tool_result_budget_chars=1_000, replacement_state=state
        )
        self.assertEqual(first.report.replaced_tool_use_ids, ("call-1",))
        self.assertEqual(second.report.replaced_tool_use_ids, ("call-1",))
        self.assertEqual(first.messages, second.messages)
        self.assertIn("call-1", state.seen_ids)
        self.assertIn("call-1", state.replacements)

    def test_previously_visible_result_stays_frozen_when_fresh_content_exceeds_budget(self) -> None:
        state = ContentReplacementState()
        messages = (
            DomainMessage(
                "assistant",
                "a-1",
                response_id="r-1",
                blocks=(
                    {"type": "tool_use", "id": "call-1", "name": "read", "input": {}},
                    {"type": "tool_use", "id": "call-2", "name": "read", "input": {}},
                ),
            ),
            DomainMessage("tool-result", "tr-1", "a" * 60, tool_use_id="call-1"),
            DomainMessage("tool-result", "tr-2", "b" * 20, tool_use_id="call-2"),
        )
        project_request(
            messages[:2],
            tool_result_budget_chars=100,
            replacement_state=state,
            pairing="repair",
        )
        second = project_request(
            messages, tool_result_budget_chars=70, replacement_state=state
        )
        rendered = repr(second.messages)
        self.assertEqual(second.report.replaced_tool_use_ids, ("call-2",))
        self.assertIn("a" * 60, rendered)
        self.assertIn("call-2 omitted", rendered)

    def test_strict_pairing_rejects_missing_result(self) -> None:
        broken = tuple(m for m in history() if m.kind not in {"tool-result", "attachment"})
        with self.assertRaises(ProjectionError):
            project_request(broken)

    def test_repair_pairing_reports_synthetic_result(self) -> None:
        broken = tuple(m for m in history() if m.kind not in {"tool-result", "attachment"})
        projected = project_request(broken, pairing="repair")
        self.assertEqual(projected.report.repaired_missing_tool_use_ids, ("call-1",))
        self.assertIn("missing tool result repaired", repr(projected.messages))

    def test_final_params_are_built_after_projection(self) -> None:
        projected = project_request(history())
        params = build_final_params(
            "model-test",
            projected,
            ({"name": "read", "input_schema": {"type": "object"}},),
            1024,
        )
        self.assertIs(params["stream"], True)
        self.assertEqual(params["messages"], projected.messages)
        self.assertEqual(params["max_tokens"], 1024)


if __name__ == "__main__":
    unittest.main()
