from __future__ import annotations

import asyncio
import json
from typing import Any

from harness import (
    AgentLoop,
    CancellationToken,
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


class WeatherTool:
    name = "lookup_weather"

    async def execute(
        self, input_data: dict[str, Any], token: CancellationToken
    ) -> int:
        return 31


async def main() -> None:
    ids = IdSource()
    session = SessionStore()
    trace = TraceSink()

    def second_request(request: dict[str, Any], _: int) -> dict[str, Any]:
        result = find_tool_result(request["messages"], "call-1")
        return assistant_with_text(
            "assistant-2", f"The observed temperature is {result['content']} C."
        )

    model = ScriptedModel(
        [
            lambda request, index: assistant_with_tool(
                "assistant-1",
                "call-1",
                "lookup_weather",
                {"city": "Shanghai"},
            ),
            second_request,
        ]
    )
    loop = AgentLoop(
        session,
        RequestProjector(ids),
        model,
        [WeatherTool()],
        ids,
        trace,
    )
    result = await loop.submit(
        "What is the weather in Shanghai?",
        ReplInputAdapter(),
        CancellationToken(),
    )
    print(
        json.dumps(
            {"status": result.status, "events": trace.events},
            indent=2,
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
