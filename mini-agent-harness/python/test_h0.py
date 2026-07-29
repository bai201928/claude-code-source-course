import unittest

from h0 import (
    CancellationScope,
    H0Harness,
    ProcessInputResult,
    ResourceScope,
    RunState,
    collect,
    parse_message,
    transition,
)


async def input_processor(prompt, _history):
    return ProcessInputResult([{"kind": "user", "text": prompt}], True)


class H0Tests(unittest.IsolatedAsyncioTestCase):
    async def test_external_message_is_runtime_validated(self) -> None:
        self.assertEqual(
            parse_message({"kind": "user", "text": "hi"}),
            {"kind": "user", "text": "hi"},
        )
        with self.assertRaisesRegex(ValueError, "invalid"):
            parse_message({"kind": "user", "text": 7})

    async def test_terminal_state_cannot_restart(self) -> None:
        self.assertEqual(
            transition(RunState("running"), RunState("completed")),
            RunState("completed"),
        )
        with self.assertRaisesRegex(ValueError, "invalid transition"):
            transition(RunState("completed"), RunState("running"))

    async def test_main_stream_commits_incrementally(self) -> None:
        async def query(_messages, _cancellation):
            yield {"kind": "progress", "text": "working"}
            yield {"kind": "assistant", "text": "done"}

        harness = H0Harness(input_processor, query)
        output = await collect(harness.run("hello"))
        self.assertEqual([message["kind"] for message in output], ["progress", "assistant"])
        self.assertEqual(harness.state.status, "completed")
        self.assertEqual(
            [message["kind"] for message in harness.messages],
            ["user", "progress", "assistant"],
        )
        self.assertEqual(harness.trace.events[-1].type, "cleanup.finished")

    async def test_local_branch_does_not_call_query(self) -> None:
        calls = 0

        async def local_input(prompt, _history):
            return ProcessInputResult(
                [{"kind": "user", "text": prompt}], False
            )

        async def query(_messages, _cancellation):
            nonlocal calls
            calls += 1
            yield {"kind": "assistant", "text": "unreachable"}

        harness = H0Harness(local_input, query)
        self.assertEqual(await collect(harness.run("/local")), [])
        self.assertEqual(calls, 0)
        self.assertEqual(harness.state.status, "completed")
        self.assertIn("branch.skipped", [event.type for event in harness.trace.events])

    async def test_cancellation_keeps_reason_and_precedes_cleanup(self) -> None:
        cancellation = CancellationScope()

        async def query(_messages, active_cancel):
            yield {"kind": "progress", "text": "first"}
            await active_cancel.wait()

        harness = H0Harness(input_processor, query)
        async for message in harness.run("hello", cancellation):
            self.assertEqual(message["kind"], "progress")
            cancellation.cancel("user_cancelled")
        self.assertEqual(harness.state, RunState("cancelled", reason="user_cancelled"))
        types = [event.type for event in harness.trace.events]
        self.assertLess(types.index("cancel.requested"), types.index("cleanup.finished"))

    async def test_partial_event_remains_after_failure(self) -> None:
        async def query(_messages, _cancellation):
            yield {"kind": "assistant", "text": "partial"}
            raise RuntimeError("model failed")

        harness = H0Harness(input_processor, query)
        with self.assertRaisesRegex(RuntimeError, "model failed"):
            await collect(harness.run("hello"))
        self.assertEqual(harness.state.status, "failed")
        self.assertEqual(
            [message["text"] for message in harness.messages],
            ["hello", "partial"],
        )
        self.assertEqual(harness.trace.events[-1].type, "cleanup.finished")

    async def test_resource_cleanup_is_reverse_and_idempotent(self) -> None:
        scope = ResourceScope()
        trace = []
        scope.register(lambda: trace.append("first"))
        scope.register(lambda: trace.append("second"))
        await scope.dispose()
        await scope.dispose()
        self.assertEqual(trace, ["second", "first"])


if __name__ == "__main__":
    unittest.main()
