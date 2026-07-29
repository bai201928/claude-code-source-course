import assert from 'node:assert/strict'
import {
  ResourceScope,
  observeEventLoop,
  runChildProcess,
} from './runtimeHarness.ts'

let passed = 0
async function test(name: string, body: () => Promise<void>): Promise<void> {
  await body()
  passed += 1
  console.log(`ok - ${name}`)
}

await test('microtask runs before zero-delay timer', async () => {
  assert.deepEqual(await observeEventLoop(), ['sync', 'microtask', 'timer'])
})

await test('child stdout and stderr arrive before confirmed exit result', async () => {
  const result = await runChildProcess()
  assert.equal(result.status, 'completed')
  assert.match(result.stdout, /tick:1/)
  assert.match(result.stdout, /tick:3/)
  assert.match(result.stderr, /diagnostic:2/)
  assert.equal(result.events.at(-1)?.type, 'cleanup.finished')
})

await test('external abort requests termination then waits for exit', async () => {
  const controller = new AbortController()
  const result = await runChildProcess({
    count: 100,
    intervalMs: 20,
    signal: controller.signal,
    onStdout: () => controller.abort('user_cancelled'),
  })
  assert.equal(result.status, 'cancelled')
  const cancelIndex = result.events.findIndex(event => event.type === 'cancel.requested')
  const exitIndex = result.events.findIndex(event => event.type === 'process.exited')
  assert.ok(cancelIndex >= 0 && exitIndex > cancelIndex)
})

await test('timeout is distinct from external cancellation', async () => {
  const result = await runChildProcess({ count: 100, intervalMs: 20, timeoutMs: 35 })
  assert.equal(result.status, 'timed_out')
  assert.ok(result.events.some(event => event.type === 'cancel.requested' && event.reason === 'timeout'))
})

await test('resource cleanup is reverse-order and idempotent', async () => {
  const trace: string[] = []
  const scope = new ResourceScope()
  scope.register(() => trace.push('first'))
  scope.register(async () => trace.push('second'))
  await scope.dispose()
  await scope.dispose()
  assert.deepEqual(trace, ['second', 'first'])
})

console.log(`TypeScript M03 runtime tests: ${passed} passed`)
