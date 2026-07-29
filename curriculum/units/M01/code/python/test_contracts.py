import unittest

from contracts import (
    RunState,
    UserMessage,
    WeatherTool,
    execute_tool,
    parse_message,
    summarize_message,
    transition_run_state,
)


class ContractTests(unittest.IsolatedAsyncioTestCase):
    def test_discriminant_selects_the_legal_fields(self) -> None:
        message = UserMessage(kind="user", id="m-1", timestamp="now", content="hello")
        self.assertEqual(summarize_message(message), "user:hello")

    def test_unknown_input_is_checked_at_runtime(self) -> None:
        with self.assertRaisesRegex(ValueError, "Invalid message variant"):
            parse_message({"kind": "user", "id": "m-2", "timestamp": "now", "blocks": []})

    def test_value_union_does_not_replace_transition_validation(self) -> None:
        with self.assertRaisesRegex(ValueError, "Illegal transition"):
            transition_run_state(RunState("completed"), RunState("running"))

    async def test_generic_tool_still_validates_external_input(self) -> None:
        output = await execute_tool(WeatherTool(), {"city": "Shanghai"})
        self.assertEqual(output.temperature_c, 31)
        with self.assertRaisesRegex(ValueError, "Invalid input"):
            await execute_tool(WeatherTool(), {"city": 42})


if __name__ == "__main__":
    unittest.main()
