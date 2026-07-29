from __future__ import annotations

import asyncio
import unittest
from typing import Any

from query_loop import (
    CancellationToken,
    DurableConversation,
    QueryRun,
    ScriptedModel,
    TraceRecorder,
    assistant_text,
    assistant_tool,
    find_tool_result,
    query_events,
    user_text,
)


class AddTool:
    name = "add"

    async def execute(
        self,
        input_data: dict[str, Any],
        token: CancellationToken,
    ) -> int:
        token.raise_if_cancelled()
        return int(input_data["left"]) + int(input_data["right"])


async def drain(run: QueryRun, trace: TraceRecorder) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    async for event in query_events(run, trace):
        events.append(event)
    return events


class QueryLoopTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_round_tool_loop_and_terminal_side_channel(self) -> None:
        def second_request(
            messages: list[dict[str, Any]],
            _token: CancellationToken,
            _index: int,
        ) -> dict[str, Any]:
            result = find_tool_result(messages, "call-1")
            self.assertEqual(result["content"] if result else None, 42)
            return assistant_text("42")

        model = ScriptedModel(
            [
                lambda _messages, _token, _index: assistant_tool(
                    "call-1",
                    "add",
                    {"left": 20, "right": 22},
                ),
                second_request,
            ]
        )
        trace = TraceRecorder()
        run = QueryRun(
            [user_text("20 + 22")],
            model,
            [AddTool()],
            CancellationToken(),
            trace,
        )

        events = await drain(run, trace)

        self.assertEqual(run.terminal.reason if run.terminal else None, "completed")
        self.assertEqual(run.terminal.turns if run.terminal else None, 2)
        self.assertEqual([len(request) for request in model.requests], [1, 3])
        self.assertEqual(
            [event["type"] for event in events],
            ["request", "assistant", "tool_result", "request", "assistant"],
        )

    async def test_yield_ordering_and_separate_durable_owner(self) -> None:
        trace = TraceRecorder()
        initial = [user_text("hello")]
        durable = DurableConversation(initial)
        run = QueryRun(
            initial,
            ScriptedModel(
                [lambda _messages, _token, _index: assistant_text("hi")]
            ),
            [],
            CancellationToken(),
            trace,
        )
        iterator = query_events(run, trace)

        await anext(iterator)
        assistant_event = await anext(iterator)
        trace.record("consumer.assistant.persist")
        durable.consume(assistant_event)
        with self.assertRaises(StopAsyncIteration):
            await anext(iterator)

        self.assertEqual(len(durable.snapshot()), 2)
        self.assertEqual(
            [entry["type"] for entry in trace.entries],
            [
                "producer.request.before_yield",
                "producer.request.after_yield",
                "producer.assistant.before_yield",
                "consumer.assistant.persist",
                "producer.assistant.after_yield",
                "producer.loop.finally",
                "wrapper.normal_completion",
                "wrapper.finally",
            ],
        )

    async def test_aclose_skips_post_yield_bookkeeping(self) -> None:
        trace = TraceRecorder()
        run = QueryRun(
            [user_text("close")],
            ScriptedModel(
                [lambda _messages, _token, _index: assistant_text("visible")]
            ),
            [],
            CancellationToken(),
            trace,
        )
        iterator = query_events(run, trace)

        await anext(iterator)
        await anext(iterator)
        await iterator.aclose()

        names = [entry["type"] for entry in trace.entries]
        self.assertIn("producer.assistant.before_yield", names)
        self.assertNotIn("producer.assistant.after_yield", names)
        self.assertIn("producer.loop.finally", names)
        self.assertIn("wrapper.finally", names)
        self.assertNotIn("wrapper.normal_completion", names)
        self.assertIsNone(run.terminal)

    async def test_cancellation_during_model_wait(self) -> None:
        token = CancellationToken()

        async def wait_for_cancel(
            _messages: list[dict[str, Any]],
            model_token: CancellationToken,
            _index: int,
        ) -> dict[str, Any]:
            await model_token.wait()
            raise AssertionError("unreachable")

        model = ScriptedModel([wait_for_cancel])
        trace = TraceRecorder()
        run = QueryRun([user_text("wait")], model, [], token, trace)
        iterator = query_events(run, trace)

        request = await anext(iterator)
        self.assertEqual(request["type"], "request")
        waiting = asyncio.create_task(anext(iterator))
        await asyncio.sleep(0)
        token.cancel("test cancellation")
        interruption = await waiting
        self.assertEqual(interruption, {"type": "interruption", "phase": "model"})
        with self.assertRaises(StopAsyncIteration):
            await anext(iterator)

        self.assertEqual(run.terminal.reason if run.terminal else None, "aborted")
        self.assertEqual(len(model.requests), 1)

    async def test_model_error_sets_event_and_terminal(self) -> None:
        def fail(
            _messages: list[dict[str, Any]],
            _token: CancellationToken,
            _index: int,
        ) -> dict[str, Any]:
            raise RuntimeError("simulated model failure")

        trace = TraceRecorder()
        run = QueryRun(
            [user_text("fail")],
            ScriptedModel([fail]),
            [],
            CancellationToken(),
            trace,
        )
        events = await drain(run, trace)

        self.assertEqual(events[-1]["type"], "model_error")
        self.assertEqual(run.terminal.reason if run.terminal else None, "model_error")


if __name__ == "__main__":
    unittest.main()
