import unittest

from trace_harness import (
    ProcessInputResult,
    ToolProbe,
    TraceableEngine,
    TraceLog,
    collect,
    pass_tool_to_permission,
)


async def user_processor(prompt, _history):
    return ProcessInputResult([{"kind": "user", "text": prompt}], True)


class TraceHarnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_main_path_observes_calls_events_and_mutations(self) -> None:
        async def query(_messages):
            yield {"kind": "assistant", "text": "answer"}

        engine = TraceableEngine([], user_processor, query)
        self.assertEqual(
            await collect(engine.submit_message("hello")),
            [{"kind": "assistant", "text": "answer"}],
        )
        self.assertTrue(
            engine.trace.observed_call(
                "TraceableEngine.submitMessage", "processInput"
            )
        )
        self.assertTrue(
            engine.trace.observed_call(
                "TraceableEngine.submitMessage", "queryStream"
            )
        )
        self.assertEqual(
            [message["kind"] for message in engine.get_messages()],
            ["user", "assistant"],
        )

    async def test_local_branch_does_not_call_query(self) -> None:
        query_calls = 0

        async def local_processor(prompt, _history):
            return ProcessInputResult(
                [{"kind": "user", "text": f"local:{prompt}"}], False
            )

        async def query(_messages):
            nonlocal query_calls
            query_calls += 1
            yield {"kind": "assistant", "text": "unreachable"}

        engine = TraceableEngine([], local_processor, query)
        self.assertEqual(await collect(engine.submit_message("/local")), [])
        self.assertEqual(query_calls, 0)
        self.assertFalse(
            engine.trace.observed_call(
                "TraceableEngine.submitMessage", "queryStream"
            )
        )
        self.assertEqual(engine.trace.events[-1].type, "branch.skipped")

    async def test_request_view_does_not_grow_with_owner_appends(self) -> None:
        retained_view = []

        async def query(messages):
            retained_view.extend(messages)
            yield {"kind": "assistant", "text": "answer"}

        engine = TraceableEngine([], user_processor, query)
        await collect(engine.submit_message("hello"))
        self.assertEqual(len(retained_view), 1)
        self.assertEqual(len(engine.get_messages()), 2)

    async def test_passing_tool_is_not_invoking_tool(self) -> None:
        run_calls = 0

        def run() -> None:
            nonlocal run_calls
            run_calls += 1

        tool = ToolProbe("Read", run)
        trace = TraceLog()

        async def can_use_tool(candidate: ToolProbe) -> bool:
            return candidate.name == "Read"

        self.assertTrue(await pass_tool_to_permission(tool, can_use_tool, trace))
        self.assertEqual(run_calls, 0)
        self.assertTrue(trace.observed_call("permissionWrapper", "canUseTool"))
        self.assertFalse(trace.observed_call("permissionWrapper", "tool"))

    async def test_partial_state_remains_after_query_failure(self) -> None:
        async def query(_messages):
            yield {"kind": "assistant", "text": "partial"}
            raise RuntimeError("query failed")

        engine = TraceableEngine([], user_processor, query)
        with self.assertRaisesRegex(RuntimeError, "query failed"):
            await collect(engine.submit_message("hello"))
        self.assertEqual(
            [message["text"] for message in engine.get_messages()],
            ["hello", "partial"],
        )
        self.assertEqual(engine.trace.events[-1].type, "call.failed")


if __name__ == "__main__":
    unittest.main()
