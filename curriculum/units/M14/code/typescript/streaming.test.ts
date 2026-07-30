import assert from 'node:assert/strict'
import test from 'node:test'
import {
  StreamProtocolError,
  StreamingAssembler,
  UsageRecord,
  type RawStreamEvent,
} from './streaming.ts'

const start: RawStreamEvent = {
  type: 'message_start',
  message: { id: 'response-1', usage: { inputTokens: 12, outputTokens: 0, cacheReadInputTokens: 3 } },
}

test('assembles indexed text, thinking and fragmented tool JSON', () => {
  const assembler = new StreamingAssembler({ startedAt: 100, now: () => 145 })
  const outputs = [
    start,
    { type: 'content_block_start', index: 0, contentBlock: { type: 'text', text: 'ignored duplicate' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    { type: 'content_block_start', index: 1, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partialJson: '{"path":' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partialJson: '"README.md"}' } },
    { type: 'content_block_start', index: 2, contentBlock: { type: 'thinking' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'thinking_delta', thinking: 'plan' } },
    { type: 'content_block_delta', index: 2, delta: { type: 'signature_delta', signature: 'sig' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_stop', index: 2 },
    { type: 'message_delta', usage: { inputTokens: 0, outputTokens: 7, cacheReadInputTokens: 0 }, stopReason: 'tool_use' },
    { type: 'message_stop' },
  ] satisfies RawStreamEvent[]

  const flattened = outputs.flatMap(event => assembler.consume(event))
  const assistants = flattened.filter(output => output.type === 'assistant')
  assert.equal(assistants.length, 3)
  assert.deepEqual(assistants[0]!.message.content[0], { type: 'text', text: 'hello' })
  assert.deepEqual(assistants[1]!.message.content[0], {
    type: 'tool_use', id: 'call-1', name: 'read', input: { path: 'README.md' },
  })
  assert.deepEqual(assistants[2]!.message.content[0], { type: 'thinking', thinking: 'plan', signature: 'sig' })
  const last = assistants[2]!.message
  assert.equal(last.usage.outputTokens, 7)
  assert.equal(last.stopReason, 'tool_use')
  const firstAssistantIndex = flattened.findIndex(output => output.type === 'assistant')
  const firstStopEventIndex = flattened.findIndex(output =>
    output.type === 'stream_event' && output.event.type === 'content_block_stop')
  assert.equal(firstAssistantIndex < firstStopEventIndex, true)
  assert.equal(assembler.usageReport().ttftMs, 45)
  assert.equal(assembler.finish().messages.length, 3)
})

test('fails closed on delta before start, type mismatch and incomplete stream', () => {
  const beforeStart = new StreamingAssembler()
  assert.throws(
    () => beforeStart.consume({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }),
    StreamProtocolError,
  )

  const mismatch = new StreamingAssembler()
  mismatch.consume(start)
  mismatch.consume({ type: 'content_block_start', index: 0, contentBlock: { type: 'tool_use', id: 'call-1', name: 'read' } })
  assert.throws(
    () => mismatch.consume({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }),
    /text delta/,
  )

  const incomplete = new StreamingAssembler()
  incomplete.consume(start)
  assert.throws(() => incomplete.finish(), /without a completed message/)
})

test('message_delta mutates the already yielded object and usage remains cumulative', () => {
  const assembler = new StreamingAssembler()
  assembler.consume(start)
  assembler.consume({ type: 'content_block_start', index: 0, contentBlock: { type: 'text' } })
  assembler.consume({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } })
  const assistant = assembler.consume({ type: 'content_block_stop', index: 0 })[0]!
  assert.equal(assistant.type, 'assistant')
  const reference = assistant.message
  assembler.consume({ type: 'message_delta', usage: { inputTokens: 0, outputTokens: 4 }, stopReason: 'end_turn' })
  assert.equal(reference.usage.inputTokens, 12)
  assert.equal(reference.usage.outputTokens, 4)
  assert.equal(reference.stopReason, 'end_turn')
})

test('UsageRecord distinguishes cumulative snapshots from run-level accumulation', () => {
  const record = new UsageRecord()
  record.applyCumulative({ inputTokens: 10, outputTokens: 0 })
  record.applyCumulative({ inputTokens: 0, outputTokens: 4 })
  assert.deepEqual(record.snapshot(), { inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 0 })
  record.recordResponse(record.snapshot())
  record.recordResponse({ inputTokens: 2, outputTokens: 3, cacheReadInputTokens: 1 })
  assert.equal(record.report().responseCount, 2)
  assert.deepEqual(record.report().usage, { inputTokens: 12, outputTokens: 7, cacheReadInputTokens: 1 })
})
