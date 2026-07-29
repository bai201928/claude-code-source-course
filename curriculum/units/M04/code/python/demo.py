import asyncio
import json

from trace_harness import ProcessInputResult, TraceableEngine, collect


async def main() -> None:
    async def process_input(prompt, _history):
        return ProcessInputResult([{"kind": "user", "text": prompt}], True)

    async def query(_messages):
        yield {"kind": "assistant", "text": "first observable answer"}

    engine = TraceableEngine([], process_input, query)
    output = await collect(engine.submit_message("trace this turn"))
    print(
        json.dumps(
            {
                "output": output,
                "state": engine.get_messages(),
                "trace": engine.trace.to_dicts(),
            },
            ensure_ascii=True,
            indent=2,
        )
    )


asyncio.run(main())
