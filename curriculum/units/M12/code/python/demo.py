from __future__ import annotations

import asyncio
import json
from typing import Any

from query_loop import (
    CancellationToken,
    DurableConversation,
    QueryRun,
    ScriptedModel,
    TraceRecorder,
    assistant_text,
    assistant_tool,
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


async def main() -> None:
    initial = [user_text("What is 20 + 22?")]
    durable = DurableConversation(initial)
    trace = TraceRecorder()
    model = ScriptedModel(
        [
            lambda _messages, _token, _index: assistant_tool(
                "call-1",
                "add",
                {"left": 20, "right": 22},
            ),
            lambda _messages, _token, _index: assistant_text(
                "The answer is 42."
            ),
        ]
    )
    run = QueryRun(
        initial,
        model,
        [AddTool()],
        CancellationToken(),
        trace,
    )
    event_types: list[str] = []
    async for event in query_events(run, trace):
        durable.consume(event)
        event_types.append(event["type"])

    print(
        json.dumps(
            {
                "events": event_types,
                "terminal": (
                    {
                        "reason": run.terminal.reason,
                        "turns": run.terminal.turns,
                    }
                    if run.terminal
                    else None
                ),
                "model_request_sizes": [
                    len(request) for request in model.requests
                ],
                "durable_message_count": len(durable.snapshot()),
                "trace": [entry["type"] for entry in trace.entries],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


asyncio.run(main())
