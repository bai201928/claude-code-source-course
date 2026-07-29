from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError

from conversation_store import (
    AssistantMessage,
    ConversationStore,
    HumanMessage,
    MessageInvariantError,
    RevisionConflictError,
    ToolResultMessage,
    envelope_id,
    group_assistant_fragments,
    is_human_input,
    response_id,
    text_block,
    tool_use_block,
    tool_use_id,
)


def human(message_id: str, text: str) -> HumanMessage:
    return HumanMessage("human", envelope_id(message_id), text)


def assistant(
    message_id: str,
    response: str,
    *blocks,
) -> AssistantMessage:
    return AssistantMessage(
        "assistant",
        envelope_id(message_id),
        response_id(response),
        tuple(blocks),
    )


def result(
    message_id: str,
    use_id: str,
    output: str = "ok",
) -> ToolResultMessage:
    return ToolResultMessage(
        "tool-result",
        envelope_id(message_id),
        tool_use_id(use_id),
        output,
        False,
    )


class ConversationStoreTests(unittest.TestCase):
    def test_snapshot_membership_is_stable_across_later_appends(self) -> None:
        store = ConversationStore()
        first = store.append(0, (human("m-1", "first"),))
        store.append(1, (human("m-2", "second"),))
        self.assertEqual(first.revision, 1)
        self.assertEqual(tuple(item.id for item in first.messages), ("m-1",))
        self.assertEqual(
            tuple(item.id for item in store.snapshot().messages),
            ("m-1", "m-2"),
        )

    def test_publication_copies_and_freezes_nested_payloads(self) -> None:
        tool_input = {"path": "before.txt", "options": {"lines": [1, 2]}}
        message = assistant(
            "a-1",
            "response-1",
            tool_use_block(tool_use_id("tool-1"), "Read", tool_input),
        )
        store = ConversationStore()
        snapshot = store.append(0, (message,))
        tool_input["path"] = "after.txt"
        tool_input["options"]["lines"].append(3)
        block = snapshot.messages[0].blocks[0]  # type: ignore[union-attr]
        self.assertEqual(block.input["path"], "before.txt")  # type: ignore[union-attr]
        self.assertEqual(block.input["options"]["lines"], (1, 2))  # type: ignore[union-attr,index]
        with self.assertRaises(TypeError):
            block.input["path"] = "blocked"  # type: ignore[union-attr,index]

    def test_stale_writer_is_rejected(self) -> None:
        store = ConversationStore()
        writer_a = store.snapshot().revision
        writer_b = store.snapshot().revision
        store.append(writer_a, (human("m-a", "writer A"),))
        with self.assertRaises(RevisionConflictError):
            store.append(writer_b, (human("m-b", "writer B"),))
        self.assertEqual(
            tuple(item.id for item in store.snapshot().messages), ("m-a",)
        )
        self.assertEqual(store.traces()[-1].status, "rejected")

    def test_response_groups_fragments_without_overwriting_envelopes(self) -> None:
        shared = "provider-response-7"
        store = ConversationStore(
            (
                assistant("a-text", shared, text_block("working")),
                assistant(
                    "a-tool",
                    shared,
                    tool_use_block(
                        tool_use_id("tool-7"), "Read", {"path": "a.ts"}
                    ),
                ),
            )
        )
        groups = group_assistant_fragments(store.snapshot().messages)
        self.assertEqual(
            tuple(item.id for item in groups[response_id(shared)]),
            ("a-text", "a-tool"),
        )

    def test_human_and_tool_result_are_different_domain_kinds(self) -> None:
        self.assertTrue(is_human_input(human("m-human", "inspect")))
        self.assertFalse(is_human_input(result("m-result", "tool-8")))

    def test_orphan_and_duplicate_tool_results_fail_closed(self) -> None:
        with self.assertRaisesRegex(MessageInvariantError, "no matching"):
            ConversationStore((result("orphan", "missing"),))
        use = assistant(
            "a-use",
            "response-use",
            tool_use_block(tool_use_id("tool-9"), "Search", {"query": "owner"}),
        )
        with self.assertRaisesRegex(MessageInvariantError, "duplicate tool result"):
            ConversationStore(
                (use, result("r-1", "tool-9"), result("r-2", "tool-9"))
            )

    def test_parallel_results_become_request_ready(self) -> None:
        store = ConversationStore(
            (
                assistant(
                    "a-parallel",
                    "response-parallel",
                    tool_use_block(tool_use_id("tool-a"), "Read", {"path": "a"}),
                    tool_use_block(tool_use_id("tool-b"), "Read", {"path": "b"}),
                ),
                result("r-b", "tool-b"),
                result("r-a", "tool-a"),
            )
        )
        store.assert_request_ready(store.snapshot())

    def test_missing_or_non_adjacent_results_fail_projection(self) -> None:
        missing = ConversationStore(
            (
                assistant(
                    "a-missing",
                    "response-missing",
                    tool_use_block(
                        tool_use_id("tool-missing"), "Read", {"path": "x"}
                    ),
                ),
            )
        )
        with self.assertRaisesRegex(MessageInvariantError, "unresolved"):
            missing.assert_request_ready(missing.snapshot())

        interrupted = ConversationStore(
            (
                assistant(
                    "a-gap",
                    "response-gap",
                    tool_use_block(
                        tool_use_id("tool-gap"), "Read", {"path": "x"}
                    ),
                ),
                human("human-gap", "new prompt"),
                result("r-gap", "tool-gap"),
            )
        )
        with self.assertRaisesRegex(MessageInvariantError, "immediately follow"):
            interrupted.assert_request_ready(interrupted.snapshot())

    def test_progress_is_ephemeral(self) -> None:
        store = ConversationStore(
            (
                assistant(
                    "a-progress",
                    "response-progress",
                    tool_use_block(
                        tool_use_id("tool-progress"),
                        "Bash",
                        {"command": "build"},
                    ),
                ),
            )
        )
        before = store.snapshot()
        progress = store.publish_progress(
            envelope_id("p-1"), tool_use_id("tool-progress"), "50%"
        )
        after = store.snapshot()
        self.assertEqual(progress.sequence, 1)
        self.assertEqual(after.revision, before.revision)
        self.assertEqual(after.messages, before.messages)
        self.assertNotIn(progress.id, tuple(item.id for item in after.messages))

    def test_replace_validates_parent_without_mutating_store(self) -> None:
        store = ConversationStore((human("root", "root"),))
        child = HumanMessage(
            "human",
            envelope_id("child"),
            "child",
            envelope_id("missing-parent"),
        )
        with self.assertRaises(MessageInvariantError):
            store.replace(0, (child,))
        self.assertEqual(
            tuple(item.id for item in store.snapshot().messages), ("root",)
        )

    def test_messages_are_frozen_dataclasses(self) -> None:
        message = human("frozen", "immutable")
        with self.assertRaises(FrozenInstanceError):
            message.text = "changed"  # type: ignore[misc]


if __name__ == "__main__":
    unittest.main()
