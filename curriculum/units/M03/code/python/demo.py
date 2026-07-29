import asyncio
import json
from dataclasses import asdict

from runtime_harness import observe_event_loop, run_child_process


async def main() -> None:
    cancel = asyncio.Event()
    result = await run_child_process(
        count=100,
        interval_seconds=0.03,
        cancel_event=cancel,
        on_stdout=lambda text: cancel.set() if "tick:2" in text else None,
    )
    print(json.dumps({"event_loop": await observe_event_loop(), "process": asdict(result)}, indent=2))


asyncio.run(main())
