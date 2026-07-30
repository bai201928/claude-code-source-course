import { StreamingAssembler, type RawStreamEvent } from './streaming.ts'

const assembler = new StreamingAssembler()
const events: RawStreamEvent[] = [
  { type: 'message_start', message: { id: 'demo-response', usage: { inputTokens: 5 } } },
  { type: 'content_block_start', index: 0, contentBlock: { type: 'text' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'streamed ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'answer' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', usage: { outputTokens: 2 }, stopReason: 'end_turn' },
  { type: 'message_stop' },
]

for (const event of events) {
  for (const output of assembler.consume(event)) {
    if (output.type === 'assistant') {
      console.log('assistant:', JSON.stringify(output.message.content))
    } else {
      console.log('event:', output.event.type)
    }
  }
}
console.log('terminal:', JSON.stringify(assembler.finish()))

