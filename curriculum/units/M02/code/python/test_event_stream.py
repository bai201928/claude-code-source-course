import unittest

from event_stream import PushAsyncQueue, run_event_stream


class EventStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_generator_is_lazy_and_pull_driven(self) -> None:
        trace: list[str] = []
        iterator = run_event_stream("r-1", trace)
        self.assertEqual(trace, [])
        first = await anext(iterator)
        self.assertEqual(first.type, "run.started")
        self.assertEqual(trace, ["producer.started", "producer.before:start"])
        await iterator.aclose()
        self.assertEqual(trace[-1], "producer.finally")

    async def test_normal_stream_yields_terminal_event(self) -> None:
        trace: list[str] = []
        events = [event async for event in run_event_stream("r-2", trace)]
        self.assertEqual([event.type for event in events], ["run.started", "model.delta", "run.completed"])
        self.assertEqual(trace[-1], "producer.finally")

    async def test_consumer_early_close_runs_finally(self) -> None:
        trace: list[str] = []
        iterator = run_event_stream("r-3", trace)
        await anext(iterator)
        await iterator.aclose()
        self.assertEqual(trace[-1], "producer.finally")
        self.assertNotIn("producer.before:delta", trace)

    async def test_producer_failure_reaches_consumer_after_partial_events(self) -> None:
        trace: list[str] = []
        iterator = run_event_stream("r-4", trace, fail_after_delta=True)
        await anext(iterator)
        await anext(iterator)
        with self.assertRaisesRegex(RuntimeError, "scripted producer failure"):
            await anext(iterator)
        self.assertEqual(trace[-1], "producer.finally")

    async def test_async_iterable_facade_may_buffer_push_events(self) -> None:
        queue = PushAsyncQueue()
        queue.enqueue(1)
        queue.enqueue(2)
        self.assertEqual(queue.buffered_count, 2)
        self.assertEqual(await anext(queue), 1)
        queue.done()
        self.assertEqual(await anext(queue), 2)
        with self.assertRaises(StopAsyncIteration):
            await anext(queue)


if __name__ == "__main__":
    unittest.main()
