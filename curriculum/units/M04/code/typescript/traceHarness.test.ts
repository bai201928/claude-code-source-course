import assert from 'node:assert/strict'
import {
  collect,
  passToolToPermission,
  TraceableEngine,
  TraceLog,
  type HarnessMessage,
} from './traceHarness.ts'

let passed = 0
async function test(name: string, body: () => Promise<void>): Promise<void> {
  await body()
  passed += 1
  console.log(`ok - ${name}`)
}

const userProcessor = async (prompt: string) => ({
  messages: [{ kind: 'user', text: prompt } as const],
  shouldQuery: true,
})

await test('main path observes calls, yielded events, and owner mutations', async () => {
  async function* query(): AsyncGenerator<HarnessMessage> {
    yield { kind: 'assistant', text: 'answer' }
  }
  const engine = new TraceableEngine([], userProcessor, query)
  assert.deepEqual(await collect(engine.submitMessage('hello')), [
    { kind: 'assistant', text: 'answer' },
  ])
  assert.equal(
    engine.trace.observedCall('TraceableEngine.submitMessage', 'processInput'),
    true,
  )
  assert.equal(
    engine.trace.observedCall('TraceableEngine.submitMessage', 'queryStream'),
    true,
  )
  assert.deepEqual(engine.getMessages().map(message => message.kind), [
    'user',
    'assistant',
  ])
})

await test('local branch proves an available dependency was not called', async () => {
  let queryCalls = 0
  const engine = new TraceableEngine(
    [],
    async prompt => ({
      messages: [{ kind: 'user', text: `local:${prompt}` }],
      shouldQuery: false,
    }),
    async function* () {
      queryCalls += 1
      yield { kind: 'assistant', text: 'unreachable' }
    },
  )
  assert.deepEqual(await collect(engine.submitMessage('/local')), [])
  assert.equal(queryCalls, 0)
  assert.equal(
    engine.trace.observedCall('TraceableEngine.submitMessage', 'queryStream'),
    false,
  )
  assert.equal(engine.trace.events.at(-1)?.type, 'branch.skipped')
})

await test('request array view does not grow with later owner appends', async () => {
  let observedRequestSize = -1
  let retainedView: readonly HarnessMessage[] = []
  const engine = new TraceableEngine(
    [],
    userProcessor,
    async function* (messages) {
      observedRequestSize = messages.length
      retainedView = messages
      yield { kind: 'assistant', text: 'answer' }
    },
  )
  await collect(engine.submitMessage('hello'))
  assert.equal(observedRequestSize, 1)
  assert.equal(retainedView.length, 1)
  assert.equal(engine.getMessages().length, 2)
})

await test('passing tool as an argument is not invoking the tool', async () => {
  let runCalls = 0
  const tool = { name: 'Read', run: () => void (runCalls += 1) }
  const trace = new TraceLog()
  const allowed = await passToolToPermission(
    tool,
    async candidate => candidate.name === 'Read',
    trace,
  )
  assert.equal(allowed, true)
  assert.equal(runCalls, 0)
  assert.equal(trace.observedCall('permissionWrapper', 'canUseTool'), true)
  assert.equal(trace.observedCall('permissionWrapper', 'tool'), false)
})

await test('partial state remains observable when query later fails', async () => {
  const engine = new TraceableEngine(
    [],
    userProcessor,
    async function* () {
      yield { kind: 'assistant', text: 'partial' }
      throw new Error('query failed')
    },
  )
  await assert.rejects(() => collect(engine.submitMessage('hello')), /query failed/)
  assert.deepEqual(engine.getMessages().map(message => message.text), [
    'hello',
    'partial',
  ])
  assert.equal(engine.trace.events.at(-1)?.type, 'call.failed')
})

console.log(`TypeScript M04 trace tests: ${passed} passed`)
