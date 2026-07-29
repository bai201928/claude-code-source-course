import asyncio
import json
from dataclasses import asdict

from contracts import (
    RunState,
    WeatherTool,
    execute_tool,
    parse_message,
    summarize_message,
    transition_run_state,
)


async def main() -> None:
    message = parse_message(
        {
            "kind": "user",
            "id": "m-1",
            "timestamp": "2026-07-28T00:00:00.000Z",
            "content": "What is the weather?",
        }
    )
    state = transition_run_state(RunState("idle"), RunState("running", "turn=1"))
    weather = await execute_tool(WeatherTool(), {"city": "Shanghai"})
    state = transition_run_state(state, RunState("completed", message.id))
    print(
        json.dumps(
            {
                "message": summarize_message(message),
                "tool_output": asdict(weather),
                "final_state": asdict(state),
            },
            indent=2,
        )
    )


asyncio.run(main())
