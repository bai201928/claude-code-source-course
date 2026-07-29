import assert from 'node:assert/strict'
import {
  LifecycleCoordinator,
  SnapshotCleanupRegistry,
  type CleanupTier,
  type ShutdownRequest,
} from './lifecycle-coordinator.ts'

const budgets = (
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

await test('snapshot-shaped Promise.all starts all handlers and does not cancel a slow loser', async () => {
  const registry = new SnapshotCleanupRegistry()
  const trace: string[] = []
  let releaseSlow!: () => void
  const slow = new Promise<void>(resolve => {
    releaseSlow = resolve
  })
  registry.register(async () => {
    trace.push('slow:start')
    await slow
    trace.push('slow:done')
  })
  registry.register(async () => {
    trace.push('fail:start')
    throw new Error('boom')
  })

  await assert.rejects(registry.run(), /boom/)
  trace.push('registry:rejected')
  releaseSlow()
  await slow
  await Promise.resolve()
  assert.deepEqual(trace, [
    'slow:start',
    'fail:start',
    'registry:rejected',
    'slow:done',
  ])
})

await test('tiers are sequential while handlers inside one tier start together', async () => {
  const manager = new LifecycleCoordinator()
  const trace: string[] = []
  manager.register('checkpoint', 'critical', async () => {
    trace.push('critical-a:start')
    await Promise.resolve()
    trace.push('critical-a:end')
  })
  manager.register('history', 'critical', async () => {
    trace.push('critical-b:start')
    await Promise.resolve()
    trace.push('critical-b:end')
  })
  manager.register('mcp', 'resource', async () => {
    trace.push('resource:start')
  })
  await manager.shutdown(budgets())
  assert.ok(trace.indexOf('critical-b:start') < trace.indexOf('critical-a:end'))
  assert.ok(trace.indexOf('resource:start') > trace.indexOf('critical-b:end'))
})

await test('one failed cleanup is reported without skipping peers or later tiers', async () => {
  const manager = new LifecycleCoordinator()
  manager.register('bad', 'critical', async () => {
    throw new Error('disk unavailable')
  })
  manager.register('good', 'critical', async () => {})
  manager.register('resource', 'resource', async () => {})
  const report = await manager.shutdown(budgets())
  assert.deepEqual(
    report.results.map(result => [result.name, result.status]),
    [
      ['bad', 'failed'],
      ['good', 'completed'],
      ['resource', 'completed'],
    ],
  )
})

await test('tier timeout aborts cooperatively and remains visible in the report', async () => {
  const manager = new LifecycleCoordinator()
  let observedReason: unknown
  manager.register('slow-mcp', 'resource', signal =>
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
  const report = await manager.shutdown(budgets(100, { resource: 15 }))
  assert.equal(report.results[0]?.status, 'timed-out')
  assert.equal(observedReason, 'cleanup-tier-timeout:resource')
})

await test('the first shutdown request owns one shared promise and report', async () => {
  const manager = new LifecycleCoordinator()
  const first = manager.shutdown(budgets())
  const second = manager.shutdown({ ...budgets(), reason: 'SIGTERM', exitCode: 143 })
  assert.equal(first, second)
  const report = await first
  assert.equal(report.reason, 'user-exit')
  assert.equal(report.exitCode, 0)
})

await test('unregistered handlers stay out and late registration fails', async () => {
  const manager = new LifecycleCoordinator()
  const unregister = manager.register('temporary', 'resource', async () => {})
  unregister()
  const promise = manager.shutdown(budgets())
  assert.throws(
    () => manager.register('late', 'critical', async () => {}),
    /cannot register cleanup/,
  )
  const report = await promise
  assert.deepEqual(report.results, [])
})

await test('prepare and recovery hint happen before slow cleanup', async () => {
  const trace: string[] = []
  const manager = new LifecycleCoordinator({
    prepare: () => {
      trace.push('prepare')
      return { recoveryHint: 'resume session-42' }
    },
  })
  manager.register('checkpoint', 'critical', async () => {
    trace.push('cleanup')
  })
  const report = await manager.shutdown(budgets())
  assert.deepEqual(trace, ['prepare', 'cleanup'])
  assert.equal(report.recoveryHint, 'resume session-42')
})

await test('overall deadline triggers failsafe and skips lower tiers', async () => {
  let failsafeCalls = 0
  const manager = new LifecycleCoordinator({
    onFailsafe: () => {
      failsafeCalls += 1
    },
  })
  manager.register('hung-critical', 'critical', signal =>
    new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true })),
  )
  manager.register('resource', 'resource', async () => {})
  manager.register('analytics', 'best-effort', async () => {})
  const report = await manager.shutdown(budgets(15, { critical: 15 }))
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

console.log(`TypeScript lifecycle tests: ${passed} passed`)
