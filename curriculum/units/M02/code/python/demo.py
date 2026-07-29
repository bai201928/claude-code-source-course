import asyncio
import json
from dataclasses import asdict

from event_stream import run_event_stream


async def main() -> None:
    trace: list[str] = []
    events = [asdict(event) async for event in run_event_stream("demo-run", trace)]
    print(json.dumps({"events": events, "trace": trace}, indent=2))


asyncio.run(main())
