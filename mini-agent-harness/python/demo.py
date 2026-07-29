import asyncio
import json

from h0 import H0Harness, ProcessInputResult, collect


async def main() -> None:
    async def process_input(prompt, _history):
        return ProcessInputResult([{"kind": "user", "text": prompt}], True)

    async def query(_messages, _cancellation):
        yield {"kind": "progress", "text": "thinking"}
        yield {"kind": "assistant", "text": "H0 ready"}

    harness = H0Harness(process_input, query)
    output = await collect(harness.run("build a traceable run"))
    print(
        json.dumps(
            {
                "output": output,
                "state": harness.state.__dict__,
                "trace": harness.trace.to_dicts(),
            },
            ensure_ascii=True,
            indent=2,
        )
    )


asyncio.run(main())
