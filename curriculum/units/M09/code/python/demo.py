import asyncio
from dataclasses import asdict
import json

from lifecycle_coordinator import LifecycleCoordinator, ShutdownRequest


async def main() -> None:
    manager = LifecycleCoordinator(
        prepare=lambda _request: "claude --resume session-42",
        on_failsafe=lambda value: print(f"failsafe for {value.reason}"),
    )

    async def action(name: str) -> None:
        print(name)

    manager.register("transcript", "critical", lambda _token: action("flush transcript"))
    manager.register("mcp", "resource", lambda _token: action("close MCP"))
    manager.register("analytics", "best-effort", lambda _token: action("flush analytics"))
    report = await manager.shutdown(
        ShutdownRequest(
            "user-exit",
            0,
            500,
            {"critical": 200, "resource": 150, "best-effort": 100},
        )
    )
    print(json.dumps(asdict(report), indent=2))


if __name__ == "__main__":
    asyncio.run(main())
