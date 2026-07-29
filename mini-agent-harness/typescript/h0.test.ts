import assert from 'node:assert/strict'
import {
  collect,
  H0Harness,
  parseMessage,
  ResourceScope,
  transition,
  type HarnessMessage,
} from './h0.ts'

let passed = 0
async function test(name: string, body: () => Promise<void>): Promise<void> {
  await body()
  passed += 1
  console.log(`ok - ${name}`)
}

const input = async (prompt: string) => ({
  messages: [{ kind: 'user', text: prompt } as const],
  shouldQuery: true,
})

await test('external message is runtime validated', async () => {
  assert.deepEqual(parseMessage({ kind: 'user', text: 'hi' }), {
    kind: 'user',
    text: 'hi',
  })
  assert.throws(() => parseMessage({ kind: 'user', text: 7 }), /invalid/)
})

await test('terminal run state cannot restart', async () => {
  assert.deepEqual(
    transition({ status: 'running' }, { status: 'completed' }),
    { status: 'completed' },
  )
  assert.throws(
    () => transition({ status: 'completed' }, { status: 'running' }),
    /invalid transition/,
  )
})

await test('main stream commits events incrementally and completes', async () => {
  async function* query(): AsyncGenerator<HarnessMessage> {
    yield { kind: 'progress', text: 'working' }
    yield { kind: 'assistant', text: 'done' }
  }
  const harness = new H0Harness(input, query)
  assert.deepEqual((await collect(harness.run('hello'))).map(m => m.kind), [
    'progress',
    'assistant',
  ])
  assert.equal(harness.state.status, 'completed')
  assert.deepEqual(harness.messages.map(m => m.kind), [
    'user',
    'progress',
    'assistant',
  ])
  assert.equal(harness.trace.events.at(-1)?.type, 'cleanup.finished')
})

await test('local branch does not call query', async () => {
  let calls = 0
  const harness = new H0Harness(
    async prompt => ({
      messages: [{ kind: 'user', text: prompt }],
      shouldQuery: false,
    }),
    async function* () {
      calls += 1
      yield { kind: 'assistant', text: 'unreachable' }
    },
  )
  assert.deepEqual(await collect(harness.run('/local')), [])
  assert.equal(calls, 0)
  assert.equal(harness.state.status, 'completed')
  assert.ok(harness.trace.events.some(event => event.type === 'branch.skipped'))
})

await test('cancellation keeps reason and precedes cleanup', async () => {
  const parent = new AbortController()
  const harness = new H0Harness(
    input,
    async function* (_messages, signal) {
      yield { kind: 'progress', text: 'first' }
      if (signal.aborted) return
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => resolve(), { once: true })
      })
    },
  )
  for await (const message of harness.run('hello', {
    parentSignal: parent.signal,
  })) {
    assert.equal(message.kind, 'progress')
    parent.abort('user_cancelled')
  }
  assert.deepEqual(harness.state, {
    status: 'cancelled',
    reason: 'user_cancelled',
  })
  const types = harness.trace.events.map(event => event.type)
  assert.ok(types.indexOf('cancel.requested') < types.indexOf('cleanup.finished'))
})

await test('partial event remains after query failure', async () => {
  const harness = new H0Harness(
    input,
    async function* () {
      yield { kind: 'assistant', text: 'partial' }
      throw new Error('model failed')
    },
  )
  await assert.rejects(() => collect(harness.run('hello')), /model failed/)
  assert.equal(harness.state.status, 'failed')
  assert.deepEqual(harness.messages.map(message => message.text), [
    'hello',
    'partial',
  ])
  assert.equal(harness.trace.events.at(-1)?.type, 'cleanup.finished')
})

await test('resource cleanup is reverse-order and idempotent', async () => {
  const scope = new ResourceScope()
  const trace: string[] = []
  scope.register(() => {
    trace.push('first')
  })
  scope.register(() => {
    trace.push('second')
  })
  await scope.dispose()
  await scope.dispose()
  assert.deepEqual(trace, ['second', 'first'])
})

console.log(`TypeScript H0 tests: ${passed} passed`)
