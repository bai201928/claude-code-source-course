import asyncio

from runtime_surface import HeadlessSurface, InteractiveSurface


class DemoCore:
    async def run(self, command):
        yield {"type": "progress", "text": f"routing {command['text']}"}
        yield {"type": "result", "text": f"answer for {command['text']}"}


async def main() -> None:
    interactive = InteractiveSurface(DemoCore())
    headless = HeadlessSurface(DemoCore())

    print("interactive output")
    print((await interactive.submit("hello")).output)

    print("stream-json output")
    print(
        (
            await headless.submit(
                "hello", input_format="text", output_format="stream-json"
            )
        ).output
    )

    print("headless trace")
    print(headless.trace.to_dicts())


if __name__ == "__main__":
    asyncio.run(main())

