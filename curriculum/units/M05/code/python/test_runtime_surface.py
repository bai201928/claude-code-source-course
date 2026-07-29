import json
import unittest

from runtime_surface import HeadlessSurface, InteractiveSurface


class ScriptedCore:
    def __init__(self) -> None:
        self.commands = []

    async def run(self, command):
        self.commands.append(command)
        yield {"type": "progress", "text": f"working:{command['text']}"}
        yield {"type": "result", "text": f"done:{command['text']}"}


class RuntimeSurfaceTests(unittest.IsolatedAsyncioTestCase):
    async def test_surfaces_drive_same_core_event_contract(self) -> None:
        interactive = InteractiveSurface(ScriptedCore())
        headless = HeadlessSurface(ScriptedCore())
        a = await interactive.submit("hello")
        b = await headless.submit(
            "hello", input_format="text", output_format="stream-json"
        )
        self.assertEqual(a.events, b.events)
        self.assertEqual([event["type"] for event in a.events], ["progress", "result"])

    async def test_interactive_stays_open_across_prompts(self) -> None:
        core = ScriptedCore()
        surface = InteractiveSurface(core)
        self.assertEqual(
            (await surface.submit("one")).output,
            ["status: working:one", "assistant: done:one"],
        )
        self.assertEqual(
            (await surface.submit("two")).output,
            ["status: working:two", "assistant: done:two"],
        )
        self.assertEqual(len(core.commands), 2)

    async def test_headless_formats_only_change_projection(self) -> None:
        text = await HeadlessSurface(ScriptedCore()).submit(
            "hello", input_format="text", output_format="text"
        )
        structured = await HeadlessSurface(ScriptedCore()).submit(
            "hello", input_format="text", output_format="json"
        )
        stream = await HeadlessSurface(ScriptedCore()).submit(
            "hello", input_format="text", output_format="stream-json"
        )
        self.assertEqual(text.output, ["done:hello"])
        self.assertEqual(len(json.loads(structured.output[0])["events"]), 2)
        self.assertEqual(len(stream.output), 2)
        self.assertTrue(all(line.endswith("\n") for line in stream.output))
        self.assertEqual(text.events, structured.events)
        self.assertEqual(structured.events, stream.events)

    async def test_invalid_ndjson_is_rejected_before_core(self) -> None:
        core = ScriptedCore()
        surface = HeadlessSurface(core)
        with self.assertRaisesRegex(ValueError, "invalid NDJSON"):
            await surface.submit(
                "{bad json}", input_format="stream-json", output_format="stream-json"
            )
        self.assertEqual(core.commands, [])
        self.assertIn("input.rejected", [event.type for event in surface.trace.events])

    async def test_multiple_ndjson_lines_preserve_order(self) -> None:
        core = ScriptedCore()
        surface = HeadlessSurface(core)
        line = lambda text: json.dumps(
            {"type": "user", "message": {"role": "user", "content": text}}
        )
        run = await surface.submit(
            f"{line('one')}\n{line('two')}\n",
            input_format="stream-json",
            output_format="stream-json",
        )
        self.assertEqual([command["text"] for command in core.commands], ["one", "two"])
        self.assertEqual(
            [event["type"] for event in run.events],
            ["progress", "result", "progress", "result"],
        )

    async def test_close_rejects_without_fake_result(self) -> None:
        core = ScriptedCore()
        surface = InteractiveSurface(core)
        surface.close()
        with self.assertRaisesRegex(RuntimeError, "surface is closed"):
            await surface.submit("late")
        self.assertEqual(core.commands, [])
        self.assertEqual([event.type for event in surface.trace.events], ["surface.closed"])

    async def test_unknown_event_fails_explicitly(self) -> None:
        class InvalidCore:
            async def run(self, _command):
                yield {"type": "future-event", "value": 1}

        surface = HeadlessSurface(InvalidCore())
        with self.assertRaisesRegex(ValueError, "unknown surface value"):
            await surface.submit("hello", input_format="text", output_format="text")


if __name__ == "__main__":
    unittest.main()

