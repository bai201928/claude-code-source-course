import unittest

from h0 import H0Harness
from h1 import H0RuntimeCore, HeadlessSurface, InteractiveSurface


def create_harness(query_factory=None):
    async def process_input(prompt, _history):
        return type(
            "Processed",
            (),
            {"messages": [{"kind": "user", "text": prompt}], "should_query": True},
        )()

    async def default_query(prompt):
        yield {"kind": "progress", "text": f"working:{prompt}"}
        yield {"kind": "assistant", "text": f"done:{prompt}"}

    active_query = query_factory or default_query

    async def query(messages, _cancellation):
        prompt = messages[-1]["text"] if messages else ""
        async for message in active_query(prompt):
            yield message

    return H0Harness(process_input, query)


class H1Tests(unittest.IsolatedAsyncioTestCase):
    async def test_h0_core_is_reused_behind_surface(self) -> None:
        harnesses = 0

        def factory():
            nonlocal harnesses
            harnesses += 1
            return create_harness()

        run = await InteractiveSurface(H0RuntimeCore(factory)).submit("hello")
        self.assertEqual(harnesses, 1)
        self.assertEqual(
            run.events,
            [
                {"type": "progress", "text": "working:hello"},
                {"type": "result", "text": "done:hello"},
            ],
        )

    async def test_surfaces_preserve_same_core_events(self) -> None:
        interactive = await InteractiveSurface(
            H0RuntimeCore(create_harness)
        ).submit("hello")
        headless = await HeadlessSurface(H0RuntimeCore(create_harness)).submit(
            "hello", input_format="text", output_format="stream-json"
        )
        self.assertEqual(interactive.events, headless.events)

    async def test_formats_only_change_projection(self) -> None:
        async def run(output_format):
            return await HeadlessSurface(H0RuntimeCore(create_harness)).submit(
                "hello", input_format="text", output_format=output_format
            )

        text = await run("text")
        json_run = await run("json")
        stream = await run("stream-json")
        self.assertEqual(text.output, ["done:hello"])
        self.assertEqual(text.events, json_run.events)
        self.assertEqual(json_run.events, stream.events)
        self.assertTrue(all(line.endswith("\n") for line in stream.output))

    async def test_invalid_ndjson_precedes_harness_creation(self) -> None:
        harnesses = 0

        def factory():
            nonlocal harnesses
            harnesses += 1
            return create_harness()

        surface = HeadlessSurface(H0RuntimeCore(factory))
        with self.assertRaisesRegex(ValueError, "invalid NDJSON"):
            await surface.submit(
                "{bad json}",
                input_format="stream-json",
                output_format="stream-json",
            )
        self.assertEqual(harnesses, 0)

    async def test_multiple_ndjson_messages_preserve_order(self) -> None:
        prompts = []

        async def query(prompt):
            prompts.append(prompt)
            yield {"kind": "assistant", "text": f"done:{prompt}"}

        surface = HeadlessSurface(H0RuntimeCore(lambda: create_harness(query)))
        payload = "\n".join(
            [
                '{"type":"user","message":{"role":"user","content":"one"}}',
                '{"type":"user","message":{"role":"user","content":"two"}}',
            ]
        )
        await surface.submit(
            payload, input_format="stream-json", output_format="stream-json"
        )
        self.assertEqual(prompts, ["one", "two"])

    async def test_h0_failure_becomes_surface_event(self) -> None:
        async def failing_query(_prompt):
            yield {"kind": "progress", "text": "partial"}
            raise RuntimeError("model failed")

        run = await HeadlessSurface(
            H0RuntimeCore(lambda: create_harness(failing_query))
        ).submit("hello", input_format="text", output_format="text")
        self.assertEqual(
            run.events,
            [
                {"type": "progress", "text": "partial"},
                {"type": "failure", "message": "model failed"},
            ],
        )
        self.assertEqual(run.output, ["Execution error: model failed"])

    async def test_closed_surface_rejects_without_harness(self) -> None:
        harnesses = 0

        def factory():
            nonlocal harnesses
            harnesses += 1
            return create_harness()

        surface = InteractiveSurface(H0RuntimeCore(factory))
        surface.close()
        with self.assertRaisesRegex(RuntimeError, "surface is closed"):
            await surface.submit("late")
        self.assertEqual(harnesses, 0)


if __name__ == "__main__":
    unittest.main()
