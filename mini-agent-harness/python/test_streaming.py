import asyncio
import unittest

from streaming import AgentRunStream


class StreamingTests(unittest.IsolatedAsyncioTestCase):
    async def test_bounded_stream_completes_and_is_single_consumer(self):
        async def source(_signal):
            yield 1
            yield 2

        stream = AgentRunStream(source, capacity=1)
        values = [value async for value in stream]
        self.assertEqual(values, [1, 2])
        self.assertEqual(
            await stream.terminal,
            type(await stream.terminal)("completed", 2),
        )
        with self.assertRaisesRegex(RuntimeError, "one consumer"):
            stream.__aiter__()

    async def test_close_cancels_source_and_runs_finally(self):
        cleaned = False

        async def source(signal):
            nonlocal cleaned
            try:
                yield "first"
                await signal.wait()
            finally:
                cleaned = True

        stream = AgentRunStream(source, capacity=1)
        iterator = stream.__aiter__()
        self.assertEqual(await iterator.__anext__(), "first")
        terminal = await stream.aclose("stop")
        self.assertEqual(terminal.status, "cancelled")
        self.assertTrue(cleaned)

    async def test_capacity_stops_the_next_upstream_pull(self):
        produced = 0

        async def source(_signal):
            nonlocal produced
            produced += 1
            yield "first"
            produced += 1
            yield "second"

        stream = AgentRunStream(source, capacity=1)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.assertEqual(produced, 1)
        iterator = stream.__aiter__()
        self.assertEqual(await iterator.__anext__(), "first")
        self.assertEqual(await iterator.__anext__(), "second")
        with self.assertRaises(StopAsyncIteration):
            await iterator.__anext__()
        self.assertEqual((await stream.terminal).item_count, 2)

    async def test_failed_producer_exposes_metadata_only(self):
        async def source(_signal):
            raise RuntimeError("provider payload must not escape")
            yield "unreachable"

        stream = AgentRunStream(source)
        with self.assertRaises(StopAsyncIteration):
            await stream.__anext__()
        terminal = await stream.terminal
        self.assertEqual(terminal.status, "failed")
        self.assertEqual(terminal.error_category, "RuntimeError")


if __name__ == "__main__":
    unittest.main()
