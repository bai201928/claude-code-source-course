from __future__ import annotations

import unittest

from agent_runtime import (
    AgentRuntime,
    CancellationSignal,
    OperationCancelled,
    PermissionGate,
    ScriptedModel,
    ToolRegistry,
    TraceRecorder,
)
from compact import (
    CompactCoordinator,
    CompactInvariantError,
    InMemoryCompactJournal,
    recover_compaction,
)
from conversation_store import (
    AssistantMessage,
    ConversationStore,
    HumanMessage,
    SystemMessage,
    ToolResultMessage,
    envelope_id,
    response_id,
    text_block,
    tool_use_block,
    tool_use_id,
)


class Summarizer:
    def __init__(self, text: str, on_call=None) -> None:
        self._text = text
        self._on_call = on_call

    async def summarize(self, _messages, _signal) -> str:
        if self._on_call is not None:
            self._on_call()
        return self._text


class CompactHarnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_runtime_compact_commits_and_trace_is_metadata_only(self) -> None:
        store = ConversationStore(history())
        journal = InMemoryCompactJournal()
        trace = TraceRecorder()
        runtime = runtime_for(store, journal, trace)

        result = await runtime.compact(
            Summarizer("Earlier work and one tool call are complete."),
            CancellationSignal(),
            retain_last=1,
        )

        self.assertEqual((result.source_revision, result.committed_revision), (0, 1))
        self.assertEqual(
            tuple(record.phase for record in journal.records()),
            ("prepared", "committed"),
        )
        self.assertEqual(
            tuple(message.kind for message in store.snapshot().messages),
            ("system", "system", "system", "human"),
        )
        store.assert_request_ready(store.snapshot())
        self.assertEqual(
            tuple(event.event_type for event in trace.events),
            ("compact.started", "compact.prepared", "compact.committed"),
        )
        self.assertFalse(
            any(
                key.lower() in {"content", "messages", "text"}
                for event in trace.events
                for key in event.attributes
            )
        )

    async def test_summary_cancellation_changes_neither_owner_nor_journal(self) -> None:
        store = ConversationStore(history())
        journal = InMemoryCompactJournal()
        runtime = runtime_for(store, journal)
        before = store.snapshot()
        signal = CancellationSignal()

        with self.assertRaises(OperationCancelled):
            await runtime.compact(
                Summarizer("must not commit", lambda: signal.cancel("test")),
                signal,
                retain_last=1,
            )

        self.assertEqual(store.snapshot(), before)
        self.assertEqual(journal.records(), ())

    async def test_cancel_after_prepared_record_recovers_original(self) -> None:
        signal = CancellationSignal()
        journal = InMemoryCompactJournal(
            lambda record: signal.cancel("after prepare")
            if record.phase == "prepared"
            else None
        )
        store = ConversationStore(history())
        runtime = runtime_for(store, journal)

        with self.assertRaises(OperationCancelled):
            await runtime.compact(
                Summarizer("summary"), signal, retain_last=1
            )

        restored, report = recover_compaction(store.snapshot(), journal.records())
        self.assertEqual((report.status, report.reason), ("fell_back", "prepared_only"))
        self.assertEqual(restored, history())
        self.assertEqual(store.revision, 0)

    async def test_stale_plan_is_rejected_before_journal_mutation(self) -> None:
        store = ConversationStore(history())
        journal = InMemoryCompactJournal()
        coordinator = CompactCoordinator(store, journal)
        plan = await coordinator.prepare(
            Summarizer("summary"),
            transaction_id="tx-stale",
            boundary_id="boundary-stale",
            summary_id="summary-stale",
            retain_last=1,
            signal=CancellationSignal(),
        )
        store.append(
            store.revision,
            (
                HumanMessage(
                    "human",
                    envelope_id("late-writer"),
                    "late writer",
                    envelope_id("human-2"),
                ),
            ),
        )
        owner = object()
        store.bind_runtime(owner)
        lease = store.acquire_run(owner)

        with self.assertRaises(CompactInvariantError):
            coordinator.commit(plan, lease, CancellationSignal())
        store.release_run(owner, lease)
        self.assertEqual(journal.records(), ())
        self.assertEqual(store.revision, 1)

    async def test_retained_tail_expands_to_keep_tool_pair(self) -> None:
        store = ConversationStore(history())
        coordinator = CompactCoordinator(store)
        plan = await coordinator.prepare(
            Summarizer("summary"),
            transaction_id="tx-pair",
            boundary_id="boundary-pair",
            summary_id="summary-pair",
            retain_last=2,
            signal=CancellationSignal(),
        )

        self.assertEqual(
            plan.provenance.retained_message_ids,
            ("assistant-1", "result-1", "human-2"),
        )
        candidate = ConversationStore(plan.replacement)
        candidate.assert_request_ready(candidate.snapshot())


def runtime_for(
    store: ConversationStore,
    journal: InMemoryCompactJournal,
    trace: TraceRecorder | None = None,
) -> AgentRuntime:
    return AgentRuntime(
        model=ScriptedModel(()),
        tools=ToolRegistry(),
        permission_gate=PermissionGate(),
        conversation=store,
        compact_journal=journal,
        trace=trace,
    )


def history():
    return (
        SystemMessage("system", envelope_id("system-1"), "You are an agent."),
        HumanMessage(
            "human",
            envelope_id("human-1"),
            "Read the file.",
            envelope_id("system-1"),
        ),
        AssistantMessage(
            "assistant",
            envelope_id("assistant-1"),
            response_id("response-1"),
            (
                text_block("I will inspect it."),
                tool_use_block(
                    tool_use_id("call-1"), "read_file", {"path": "a.txt"}
                ),
            ),
            envelope_id("human-1"),
        ),
        ToolResultMessage(
            "tool-result",
            envelope_id("result-1"),
            tool_use_id("call-1"),
            "content",
            False,
            envelope_id("assistant-1"),
        ),
        HumanMessage(
            "human",
            envelope_id("human-2"),
            "Continue.",
            envelope_id("result-1"),
        ),
    )


if __name__ == "__main__":
    unittest.main()
