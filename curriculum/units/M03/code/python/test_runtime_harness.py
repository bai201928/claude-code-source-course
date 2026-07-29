import asyncio
import unittest

from runtime_harness import ResourceScope, observe_event_loop, run_child_process


class RuntimeHarnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_call_soon_runs_before_zero_delay_timer(self) -> None:
        self.assertEqual(await observe_event_loop(), ["sync", "call_soon", "timer"])

    async def test_child_streams_and_completes(self) -> None:
        result = await run_child_process()
        self.assertEqual(result.status, "completed")
        self.assertIn("tick:1", result.stdout)
        self.assertIn("tick:3", result.stdout)
        self.assertIn("diagnostic:2", result.stderr)
        self.assertEqual(result.events[-1].type, "cleanup.finished")

    async def test_external_cancel_waits_for_exit(self) -> None:
        cancel = asyncio.Event()
        result = await run_child_process(
            count=100,
            cancel_event=cancel,
            on_stdout=lambda _text: cancel.set(),
        )
        self.assertEqual(result.status, "cancelled")
        types = [event.type for event in result.events]
        self.assertLess(types.index("cancel.requested"), types.index("process.exited"))

    async def test_timeout_is_distinct(self) -> None:
        result = await run_child_process(count=100, timeout_seconds=0.035)
        self.assertEqual(result.status, "timed_out")

    async def test_resource_scope_is_reverse_order_and_idempotent(self) -> None:
        trace: list[str] = []
        scope = ResourceScope()
        scope.register(lambda: trace.append("first"))
        scope.register(lambda: trace.append("second"))
        await scope.dispose()
        await scope.dispose()
        self.assertEqual(trace, ["second", "first"])


if __name__ == "__main__":
    unittest.main()
