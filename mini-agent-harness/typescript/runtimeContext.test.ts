import assert from 'node:assert/strict'
import { resolveConfiguration } from './configuration.ts'
import {
  createRequestContext,
  createRuntimeContext,
  createSessionStateStore,
  createSynchronousStore,
  readFreshSession,
} from './runtimeContext.ts'

let passed = 0
function test(name: string, body: () => void): void {
  body()
  passed += 1
  console.log(`ok - ${name}`)
}

test('M06 configuration revision enters the immutable runtime context', () => {
  const configuration = resolveConfiguration({ revision: 7 })
  const runtime = createRuntimeContext({
    runtimeId: 'runtime-1',
    configurationRevision: configuration.revision,
    modelAdapter: 'fake-model',
    startedAt: 100,
  })
  assert.equal(runtime.configurationRevision, 7)
  assert.equal(Object.isFrozen(runtime), true)
})

test('runtime dependencies fail before request start', () => {
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

test('same root mutation is silent even though direct reads see it', () => {
  const trace: string[] = []
  const store = createSynchronousStore({ count: 0 }, () => trace.push('observer'))
  store.subscribe(() => trace.push('subscriber'))
  store.setState(previous => {
    previous.count = 1
    return previous
  })
  assert.equal(store.getState().count, 1)
  assert.deepEqual(trace, [])
})

test('observer precedes ordered subscribers and unsubscribe is idempotent', () => {
  const trace: string[] = []
  const store = createSynchronousStore({ count: 0 }, change => {
    trace.push(`observer:${change.newState.count}`)
  })
  store.subscribe(() => trace.push('first'))
  const unsubscribe = store.subscribe(() => trace.push('second'))
  store.setState(previous => ({ count: previous.count + 1 }))
  unsubscribe()
  unsubscribe()
  store.setState(previous => ({ count: previous.count + 1 }))
  assert.deepEqual(trace, ['observer:1', 'first', 'second', 'observer:2', 'first'])
})

test('listener failure leaves state committed and stops later listeners', () => {
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

test('old request snapshot and explicit fresh read can coexist', () => {
  const runtime = createRuntimeContext({
    runtimeId: 'runtime-1',
    configurationRevision: 7,
    modelAdapter: 'fake-model',
  })
  const session = createSessionStateStore({ mode: 'default', tools: ['Read'] })
  const request = createRequestContext(runtime, session, 'request-1')
  session.publish({ mode: 'plan', tools: ['Read', 'Glob'] })
  const fresh = readFreshSession(request, session)
  assert.equal(request.sessionRevision, 1)
  assert.equal(request.sessionValues.mode, 'default')
  assert.equal(fresh.observedSessionRevision, 2)
  assert.equal(fresh.sessionValues.mode, 'plan')
})

console.log(`TypeScript runtime context tests: ${passed} passed`)

