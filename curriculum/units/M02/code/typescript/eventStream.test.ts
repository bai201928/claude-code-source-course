import assert from 'node:assert/strict'
import {
  PushAsyncQueue,
  delegatedRun,
  runEventStream,
  type HarnessEvent,
  type RunSummary,
} from './eventStream.ts'

let passed = 0

async function test(name: string, body: () => Promise<void>): Promise<void> {
  await body()
  passed += 1
  console.log(`ok - ${name}`)
}

await test('async generator is lazy and advances one pull at a time', async () => {
  const trace: string[] = []
  const iterator = runEventStream('r-1', trace)
  assert.deepEqual(trace, [])
  assert.deepEqual(await iterator.next(), {
    done: false,
    value: { type: 'run.started', runId: 'r-1' },
  })
  assert.deepEqual(trace, ['producer.started', 'producer.before:start'])
  await iterator.return({ runId: 'r-1', yielded: 1 })
  assert.equal(trace.at(-1), 'producer.finally')
})

await test('yield star forwards events and preserves the terminal value', async () => {
  const trace: string[] = []
  const iterator = delegatedRun('r-2', trace)
  const events: HarnessEvent[] = []
  let summary: RunSummary | undefined
  while (true) {
    const step = await iterator.next()
    if (step.done) {
      summary = step.value
      break
    }
    events.push(step.value)
  }
  assert.equal(events.length, 3)
  assert.deepEqual(summary, { runId: 'r-2', yielded: 3 })
  assert.ok(trace.includes('delegate.return:3'))
})

await test('consumer early return runs producer finally', async () => {
  const trace: string[] = []
  const iterator = runEventStream('r-3', trace)
  await iterator.next()
  await iterator.return({ runId: 'r-3', yielded: 1 })
  assert.equal(trace.at(-1), 'producer.finally')
  assert.equal(trace.includes('producer.before:delta'), false)
})

await test('early return through yield star skips normal completion code', async () => {
  const trace: string[] = []
  const iterator = delegatedRun('r-3b', trace)
  await iterator.next()
  assert.deepEqual(await iterator.return({ runId: 'r-3b', yielded: 1 }), {
    done: true,
    value: { runId: 'r-3b', yielded: 1 },
  })
  assert.equal(trace.includes('delegate.return:1'), false)
  assert.deepEqual(trace.slice(-2), ['producer.finally', 'delegate.finally'])
})

await test('producer failure reaches the consumer after partial events', async () => {
  const trace: string[] = []
  const iterator = runEventStream('r-4', trace, { failAfterDelta: true })
  assert.equal((await iterator.next()).done, false)
  assert.equal((await iterator.next()).done, false)
  await assert.rejects(() => iterator.next(), /scripted producer failure/)
  assert.equal(trace.at(-1), 'producer.finally')
})

await test('an AsyncIterable facade may still buffer push events', async () => {
  const queue = new PushAsyncQueue<number>()
  queue.enqueue(1)
  queue.enqueue(2)
  assert.equal(queue.bufferedCount, 2)
  assert.deepEqual(await queue.next(), { done: false, value: 1 })
  assert.equal(queue.bufferedCount, 1)
  queue.done()
  assert.deepEqual(await queue.next(), { done: false, value: 2 })
  assert.deepEqual(await queue.next(), { done: true, value: undefined })
})

console.log(`TypeScript M02 contract tests: ${passed} passed`)
