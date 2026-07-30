import unittest

from streaming import StreamProtocolError, StreamingAssembler, UsageRecord


class StreamingTests(unittest.TestCase):
    def test_assembles_blocks_and_preserves_order(self):
        assembler = StreamingAssembler(started_at=100, now=145)
        events = [
            {"type": "message_start", "message": {"id": "response-1", "usage": {"input_tokens": 12, "cache_read_input_tokens": 3}}},
            {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": "ignored"}},
            {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "hello"}},
            {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "call-1", "name": "read"}},
            {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"path":'}},
            {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '"README.md"}'}},
            {"type": "content_block_stop", "index": 0},
            {"type": "content_block_stop", "index": 1},
            {"type": "message_delta", "usage": {"input_tokens": 0, "output_tokens": 7, "cache_read_input_tokens": 0}, "stop_reason": "tool_use"},
            {"type": "message_stop"},
        ]
        output = [item for event in events for item in assembler.consume(event)]
        assistants = [item for item in output if item["type"] == "assistant"]
        self.assertEqual(len(assistants), 2)
        self.assertEqual(assistants[0]["message"].content[0], {"type": "text", "text": "hello"})
        self.assertEqual(assistants[1]["message"].content[0]["input"], {"path": "README.md"})
        self.assertEqual(assistants[1]["message"].usage.output_tokens, 7)
        self.assertEqual(assembler.usage.snapshot.input_tokens, 12)
        self.assertEqual(assembler.finish()["stop_reason"], "tool_use")

    def test_fails_closed_on_invalid_order_and_incomplete_stream(self):
        assembler = StreamingAssembler()
        with self.assertRaises(StreamProtocolError):
            assembler.consume({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "x"}})
        assembler.consume({"type": "message_start", "message": {"id": "r", "usage": {}}})
        with self.assertRaises(StreamProtocolError):
            assembler.finish()

    def test_usage_record_is_not_incremental_merge(self):
        record = UsageRecord()
        record.apply_cumulative(type("Update", (), {"input_tokens": 10, "output_tokens": 0, "cache_read_input_tokens": None})())
        record.apply_cumulative(type("Update", (), {"input_tokens": 0, "output_tokens": 4, "cache_read_input_tokens": None})())
        self.assertEqual((record.snapshot.input_tokens, record.snapshot.output_tokens), (10, 4))
        record.record_response(type(record.snapshot)(**vars(record.snapshot)))
        record.record_response(type(record.snapshot)(2, 3, 1))
        self.assertEqual(record.response_count, 2)
        self.assertEqual((record.total.input_tokens, record.total.output_tokens), (12, 7))


if __name__ == "__main__":
    unittest.main()
