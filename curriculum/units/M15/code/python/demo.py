from __future__ import annotations

import asyncio

from tool_scheduler import Call, Scheduler, Tool


def tool(name: str, safe: bool) -> Tool:
    async def run(_input, progress, _cancelled):
        progress("running")
        await asyncio.sleep(.01 if safe else .02)
        return f"{name}:ok", {"last": name}

    return Tool(name, lambda value: value, lambda _value: safe, lambda _value: "allow", run)


async def main() -> None:
    scheduler = Scheduler((tool("readA", True), tool("readB", True), tool("writeC", False)))
    calls = tuple(Call(f"call-{name}", name, {}) for name in ("readA", "readB", "writeC"))
    print(await scheduler.execute(calls, asyncio.Event(), print))


if __name__ == "__main__":
    asyncio.run(main())
