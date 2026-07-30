from streaming import StreamingAssembler

assembler = StreamingAssembler()
events = [
    {"type": "message_start", "message": {"id": "demo", "usage": {"input_tokens": 5}}},
    {"type": "content_block_start", "index": 0, "content_block": {"type": "text"}},
    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "streamed answer"}},
    {"type": "content_block_stop", "index": 0},
    {"type": "message_delta", "usage": {"output_tokens": 2}, "stop_reason": "end_turn"},
    {"type": "message_stop"},
]
for event in events:
    for output in assembler.consume(event):
        print(output)
print(assembler.finish())

