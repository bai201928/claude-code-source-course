import assert from 'node:assert/strict'
import {
  LifecycleCoordinator,
  type CleanupTier,
  type ShutdownRequest,
} from './lifecycleCoordinator.ts'

const request = (
  overallBudgetMs = 200,
  overrides: Partial<Record<CleanupTier, number>> = {},
): ShutdownRequest => ({
  reason: 'user-exit',
  exitCode: 0,
  overallBudgetMs,
  tierBudgetMs: {
    critical: overrides.critical ?? 80,
    resource: overrides.resource ?? 70,
    'best-effort': overrides['best-effort'] ?? 40,
  },
})

let passed = 0
async function test(name: string, body: () => Promise<void>): Promise<void> {
  await body()
  passed += 1
  console.log(`ok - ${name}`)
}

await test('tiers run in order while handlers inside a tier start together', async () => {
  const coordinator = new LifecycleCoordinator()
  const trace: string[] = []
  coordinator.register('checkpoint', 'critical', async () => {
    trace.push('critical-a:start')
    await Promise.resolve()
    trace.push('critical-a:end')
  })
  coordinator.register('history', 'critical', async () => {
    trace.push('critical-b:start')
    await Promise.resolve()
    trace.push('critical-b:end')
  })
  coordinator.register('mcp', 'resource', async () => {
    trace.push('resource:start')
  })
  await coordinator.shutdown(request())
  assert.ok(trace.indexOf('critical-b:start') < trace.indexOf('critical-a:end'))
  assert.ok(trace.indexOf('resource:start') > trace.indexOf('critical-b:end'))
})

await test('one failure is isolated from peers and later tiers', async () => {
  const coordinator = new LifecycleCoordinator()
  coordinator.register('bad', 'critical', async () => {
    throw new Error('disk unavailable')
  })
  coordinator.register('good', 'critical', async () => {})
  coordinator.register('resource', 'resource', async () => {})
  const report = await coordinator.shutdown(request())
  assert.deepEqual(
    report.results.map(result => [result.name, result.status]),
    [
      ['bad', 'failed'],
      ['good', 'completed'],
      ['resource', 'completed'],
    ],
  )
})

await test('a tier timeout sends a cooperative cancellation reason', async () => {
  const coordinator = new LifecycleCoordinator()
  let observedReason: unknown
  coordinator.register('slow-mcp', 'resource', signal =>
    new Promise(resolve => {
      signal.addEventListener(
        'abort',
        () => {
          observedReason = signal.reason
          resolve()
        },
        { once: true },
      )
    }),
  )
  const report = await coordinator.shutdown(request(100, { resource: 15 }))
  assert.equal(report.results[0]?.status, 'timed-out')
  assert.equal(observedReason, 'cleanup-tier-timeout:resource')
})

await test('the first shutdown request owns a shared promise and report', async () => {
  const coordinator = new LifecycleCoordinator()
  const first = coordinator.shutdown(request())
  const second = coordinator.shutdown({
    ...request(),
    reason: 'SIGTERM',
    exitCode: 143,
  })
  assert.equal(first, second)
  const report = await first
  assert.equal(report.reason, 'user-exit')
  assert.equal(report.exitCode, 0)
})

await test('unregister removes work and stopping rejects new registration', async () => {
  const coordinator = new LifecycleCoordinator()
  const unregister = coordinator.register('temporary', 'resource', async () => {})
  unregister()
  const shutdown = coordinator.shutdown(request())
  assert.throws(
    () => coordinator.register('late', 'critical', async () => {}),
    /cannot register cleanup/,
  )
  assert.deepEqual((await shutdown).results, [])
})

await test('prepare and recovery hint happen before cleanup', async () => {
  const trace: string[] = []
  const coordinator = new LifecycleCoordinator({
    prepare: () => {
      trace.push('prepare')
      return { recoveryHint: 'resume session-42' }
    },
  })
  coordinator.register('checkpoint', 'critical', async () => {
    trace.push('cleanup')
  })
  const report = await coordinator.shutdown(request())
  assert.deepEqual(trace, ['prepare', 'cleanup'])
  assert.equal(report.recoveryHint, 'resume session-42')
})

await test('overall deadline invokes failsafe and skips lower tiers', async () => {
  let failsafeCalls = 0
  const coordinator = new LifecycleCoordinator({
    onFailsafe: () => {
      failsafeCalls += 1
    },
  })
  coordinator.register('hung-critical', 'critical', signal =>
    new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
  )
  coordinator.register('resource', 'resource', async () => {})
  coordinator.register('analytics', 'best-effort', async () => {})
  const report = await coordinator.shutdown(request(15, { critical: 15 }))
  assert.equal(report.deadlineExceeded, true)
  assert.equal(failsafeCalls, 1)
  assert.deepEqual(
    report.results.map(result => [result.name, result.status]),
    [
      ['hung-critical', 'timed-out'],
      ['resource', 'skipped'],
      ['analytics', 'skipped'],
    ],
  )
})

await test('invalid budgets fail before lifecycle ownership changes', async () => {
  const coordinator = new LifecycleCoordinator()
  assert.throws(
    () => coordinator.shutdown(request(Number.POSITIVE_INFINITY)),
    /overallBudgetMs must be positive/,
  )
  assert.equal(coordinator.state, 'running')
})

console.log(`TypeScript LifecycleCoordinator tests: ${passed} passed`)
