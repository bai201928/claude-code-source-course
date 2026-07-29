from __future__ import annotations

import unittest
from typing import Any

from harness import (
    AgentLoop,
    CancellationToken,
    CancelledError,
    HeadlessInputAdapter,
    IdSource,
    ReplInputAdapter,
    RequestProjector,
    ScriptedModel,
    SessionStore,
    TraceSink,
    assistant_with_text,
    assistant_with_tool,
    find_tool_result,
)


class AddTool:
    name = "add"

    async def execute(
        self, input_data: dict[str, Any], token: CancellationToken
    ) -> int:
        return int(input_data["left"]) + int(input_data["right"])


class FailingTool:
    name = "fail"

    async def execute(
        self, input_data: dict[str, Any], token: CancellationToken
    ) -> None:
        raise RuntimeError("simulated failure")


class CancellingTool:
    name = "cancel"

    async def execute(
        self, input_data: dict[str, Any], token: CancellationToken
    ) -> None:
        token.cancel("test cancellation")
        raise CancelledError("cancelled by test")


class HarnessTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_round_tool_loop(self) -> None:
        ids = IdSource()
        session = SessionStore()
        trace = TraceSink()

        def second_request(request: dict[str, Any], _: int) -> dict[str, Any]:
            result = find_tool_result(request["messages"], "call-1")
            self.assertEqual(result["content"], 42)
            self.assertFalse(result["isError"])
            return assistant_with_text("assistant-2", "The answer is 42.")

        model = ScriptedModel(
            [
                lambda request, index: assistant_with_tool(
                    "assistant-1",
                    "call-1",
                    "add",
                    {"left": 20, "right": 22},
                ),
                second_request,
            ]
        )
        loop = AgentLoop(
            session,
            RequestProjector(ids),
            model,
            [AddTool()],
            ids,
            trace,
        )

        result = await loop.submit(
            "Calculate 20 + 22", ReplInputAdapter(), CancellationToken()
        )

        self.assertEqual(result.status, "completed")
        self.assertEqual(len(model.requests), 2)
        self.assertEqual(len(model.requests[0]["messages"]), 1)
        self.assertEqual(len(model.requests[1]["messages"]), 3)
        self.assertEqual(trace.events[-1]["type"], "loop.completed")

    async def test_tool_error_becomes_protocol_message(self) -> None:
        ids = IdSource()
        session = SessionStore()
        trace = TraceSink()

        def second_request(request: dict[str, Any], _: int) -> dict[str, Any]:
            result = find_tool_result(request["messages"], "call-fail")
            self.assertTrue(result["isError"])
            self.assertEqual(result["content"], "simulated failure")
            return assistant_with_text("assistant-2", "The tool failed safely.")

        model = ScriptedModel(
            [
                lambda request, index: assistant_with_tool(
                    "assistant-1", "call-fail", "fail", {}
                ),
                second_request,
            ]
        )
        loop = AgentLoop(
            session,
            RequestProjector(ids),
            model,
            [FailingTool()],
            ids,
            trace,
        )

        result = await loop.submit(
            "Run the failing tool", HeadlessInputAdapter(), CancellationToken()
        )

        self.assertEqual(result.status, "completed")
        self.assertEqual(len(model.requests), 2)

    async def test_cancellation_stops_before_second_request(self) -> None:
        ids = IdSource()
        session = SessionStore()
        trace = TraceSink()
        token = CancellationToken()
        model = ScriptedModel(
            [
                lambda request, index: {
                    "kind": "assistant",
                    "id": "assistant-1",
                    "blocks": [
                        {
                            "type": "tool_use",
                            "id": "call-cancel",
                            "name": "cancel",
                            "input": {},
                        },
                        {
                            "type": "tool_use",
                            "id": "call-not-started",
                            "name": "not-started",
                            "input": {},
                        },
                    ],
                }
            ]
        )
        loop = AgentLoop(
            session,
            RequestProjector(ids),
            model,
            [CancellingTool()],
            ids,
            trace,
        )

        result = await loop.submit(
            "Cancel during the tool", ReplInputAdapter(), token
        )

        self.assertEqual(result.status, "cancelled")
        self.assertEqual(len(model.requests), 1)
        self.assertTrue(
            find_tool_result(session.snapshot(), "call-cancel")["isError"]
        )
        self.assertTrue(
            find_tool_result(session.snapshot(), "call-not-started")["isError"]
        )
        self.assertFalse(
            any(
                event["type"] == "tool.started"
                and event.get("detail", {}).get("tool_use_id")
                == "call-not-started"
                for event in trace.events
            )
        )
        self.assertEqual(trace.events[-1]["type"], "loop.cancelled")

    def test_projection_does_not_share_array_structure(self) -> None:
        ids = IdSource()
        session = SessionStore()
        session.append(ReplInputAdapter().accept("first", ids))
        request = RequestProjector(ids).project(session.snapshot())
        session.append(ReplInputAdapter().accept("later", ids))
        self.assertEqual(len(request["messages"]), 1)
        self.assertEqual(len(session.snapshot()), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
