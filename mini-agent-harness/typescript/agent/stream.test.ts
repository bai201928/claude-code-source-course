import assert from 'node:assert/strict'
import test from 'node:test'
import { BoundedAgentRunStream } from './stream.ts'

test('bounded stream is single-consumer and preserves terminal completion', async () => {
  const stream = new BoundedAgentRunStream(async function* () {
    yield 1
    yield 2
  }, { capacity: 1 })
  const values: number[] = []
  for await (const value of stream) values.push(value)
  assert.deepEqual(values, [1, 2])
  assert.deepEqual(await stream.terminal, { status: 'completed', itemCount: 2 })
  assert.throws(() => stream[Symbol.asyncIterator](), /one consumer/)
})

test('consumer close aborts the source and waits for its finally block', async () => {
  let cleaned = false
  let observedAbort = false
  const stream = new BoundedAgentRunStream(signal => (async function* () {
    try {
      observedAbort = signal.aborted
      yield 'first'
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
    } finally {
      cleaned = true
    }
  })(), { capacity: 1 })
  const iterator = stream[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value, 'first')
  const terminal = await stream.close('stop')
  assert.equal(terminal.status, 'cancelled')
  assert.equal(cleaned, true)
  assert.equal(observedAbort, false)
})

test('capacity stops the next upstream pull until the consumer drains', async () => {
  let produced = 0
  const stream = new BoundedAgentRunStream(async function* () {
    produced += 1
    yield 'first'
    produced += 1
    yield 'second'
  }, { capacity: 1 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(produced, 1)
  const iterator = stream[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value, 'first')
  assert.equal((await iterator.next()).value, 'second')
  assert.equal((await iterator.next()).done, true)
  assert.equal((await stream.terminal).itemCount, 2)
})

test('failed producer exposes only metadata in terminal state', async () => {
  const stream = new BoundedAgentRunStream(async function* () {
    throw new Error('provider payload must not be returned')
  })
  const iterator = stream[Symbol.asyncIterator]()
  assert.deepEqual(await iterator.next(), { value: undefined, done: true })
  assert.deepEqual(await stream.terminal, { status: 'failed', itemCount: 0, errorCategory: 'Error' })
})
