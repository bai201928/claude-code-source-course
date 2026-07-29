import assert from 'node:assert/strict'
import {
  createRequestContext,
  createRuntimeContext,
  createSessionStateStore,
  createSynchronousStore,
  readFreshSession,
} from './runtime-context.ts'

let passed = 0
function test(name: string, body: () => void): void {
  body()
  passed += 1
  console.log(`ok - ${name}`)
}

test('runtime dependencies fail before a request can start', () => {
  assert.throws(
    () =>
      createRuntimeContext({
        runtimeId: 'runtime-1',
        configurationRevision: 0,
        modelAdapter: 'fake-model',
      }),
    /positive integer/,
  )
  assert.throws(
    () => createRequestContext(undefined, undefined, 'request-1'),
    /runtime context is required/,
  )
})

test('same root mutation is visible to direct reads but sends no notification', () => {
  const trace: string[] = []
  const root = { count: 0 }
  const store = createSynchronousStore(root, () => trace.push('observer'))
  store.subscribe(() => trace.push('subscriber'))

  store.setState(previous => {
    previous.count = 1
    return previous
  })

  assert.equal(store.getState().count, 1)
  assert.deepEqual(trace, [])
})

test('new root commits before observer and ordered subscribers', () => {
  const trace: string[] = []
  const store = createSynchronousStore({ count: 0 }, change => {
    assert.equal(store.getState(), change.newState)
    trace.push(`observer:${change.oldState.count}->${change.newState.count}`)
  })
  store.subscribe(() => trace.push('subscriber:first'))
  const unsubscribe = store.subscribe(() => trace.push('subscriber:second'))

  store.setState(previous => ({ count: previous.count + 1 }))
  unsubscribe()
  unsubscribe()
  store.setState(previous => ({ count: previous.count + 1 }))

  assert.deepEqual(trace, [
    'observer:0->1',
    'subscriber:first',
    'subscriber:second',
    'observer:1->2',
    'subscriber:first',
  ])
})

test('listener failure leaves state committed and interrupts later listeners', () => {
  const trace: string[] = []
  const store = createSynchronousStore({ count: 0 })
  store.subscribe(() => {
    trace.push('first')
    throw new Error('listener failed')
  })
  store.subscribe(() => trace.push('second'))

  assert.throws(
    () => store.setState(previous => ({ count: previous.count + 1 })),
    /listener failed/,
  )
  assert.equal(store.getState().count, 1)
  assert.deepEqual(trace, ['first'])
})

test('request context freezes one session and configuration revision', () => {
  const runtime = createRuntimeContext({
    runtimeId: 'runtime-1',
    configurationRevision: 7,
    modelAdapter: 'fake-model',
    startedAt: 100,
  })
  const sessionStore = createSessionStateStore({ mode: 'default' })
  const request = createRequestContext(runtime, sessionStore, 'request-1')

  sessionStore.publish({ mode: 'plan' })

  assert.equal(request.configurationRevision, 7)
  assert.equal(request.sessionRevision, 1)
  assert.equal(request.sessionValues.mode, 'default')
  assert.equal(sessionStore.getState().revision, 2)
  assert.equal(sessionStore.getState().values.mode, 'plan')
})

test('fresh read is explicit and does not mutate the old request snapshot', () => {
  const runtime = createRuntimeContext({
    runtimeId: 'runtime-1',
    configurationRevision: 1,
    modelAdapter: 'fake-model',
  })
  const sessionStore = createSessionStateStore({ tools: ['Read'] })
  const request = createRequestContext(runtime, sessionStore, 'request-1')
  sessionStore.publish({ tools: ['Read', 'Glob'] })

  const fresh = readFreshSession(request, sessionStore)
  assert.deepEqual(request.sessionValues.tools, ['Read'])
  assert.equal(request.sessionRevision, 1)
  assert.deepEqual(fresh.sessionValues.tools, ['Read', 'Glob'])
  assert.equal(fresh.observedSessionRevision, 2)
})

test('session publication clones and freezes external input', () => {
  const input = { nested: { value: 1 } }
  const sessionStore = createSessionStateStore(input)
  input.nested.value = 2

  assert.equal(
    (sessionStore.getState().values.nested as Readonly<{ value: number }>).value,
    1,
  )
  assert.equal(Object.isFrozen(sessionStore.getState().values), true)
  assert.equal(Object.isFrozen(sessionStore.getState().values.nested), true)
})

console.log(`TypeScript M07 tests: ${passed} passed`)

