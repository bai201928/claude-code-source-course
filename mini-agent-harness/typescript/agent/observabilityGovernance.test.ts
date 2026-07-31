import assert from 'node:assert/strict'
import {
  EvaluationLedger,
  EventCollisionError,
  ReservationCancelledError,
  TelemetryRecorder,
  TenantGovernor,
  TenantQueueFullError,
  UsageCostLedger,
  type AttemptIdentity,
  type UsageCostCommand,
} from './observabilityGovernance.ts'

const identity = (attemptId = 'attempt-1', route: AttemptIdentity['route'] = 'primary'): AttemptIdentity => ({
  runId: 'run-1',
  requestId: 'request-1',
  attemptId,
  route,
})

const usage = (
  eventId: string,
  outputTokens: number,
  overrides: Partial<UsageCostCommand> = {},
): UsageCostCommand => ({
  eventId,
  identity: identity(),
  model: 'model-a',
  priceVersion: 'prices-2026-07',
  capturedAtMs: 100,
  cumulative: { inputTokens: 10, outputTokens, cacheReadTokens: 0, cacheCreationTokens: 0 },
  price: {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 2,
    cacheReadUsdPerMillion: 0.1,
    cacheCreationUsdPerMillion: 1.25,
  },
  ...overrides,
})

const tests: Array<readonly [string, () => void | Promise<void>]> = []
const test = (name: string, body: () => void | Promise<void>) => tests.push([name, body])

test('cumulative 100 -> 130 records a delta of 30', () => {
  const ledger = new UsageCostLedger()
  ledger.record(usage('usage-1', 100))
  const second = ledger.record(usage('usage-2', 130, { capturedAtMs: 200 }))
  assert.equal(second.delta.outputTokens, 30)
  assert.equal(ledger.entries().reduce((sum, item) => sum + item.delta.outputTokens, 0), 130)
})

test('usage event replay is idempotent and collision fails', () => {
  const ledger = new UsageCostLedger()
  const command = usage('usage-1', 100)
  assert.strictEqual(ledger.record(command), ledger.record(command))
  assert.equal(ledger.entries().length, 1)
  assert.throws(() => ledger.record(usage('usage-1', 101)), EventCollisionError)
})

test('retry and fallback attempts retain independent cumulative state', () => {
  const ledger = new UsageCostLedger()
  ledger.record(usage('retry-1', 50, { identity: identity('attempt-retry', 'retry') }))
  ledger.record(usage('fallback-1', 70, { identity: identity('attempt-fallback', 'fallback') }))
  assert.deepEqual(ledger.entries().map(entry => entry.delta.outputTokens), [50, 70])
  assert.deepEqual(ledger.entries().map(entry => entry.identity.route), ['retry', 'fallback'])
})

test('unknown price is explicit and missing TTFT is not zero', () => {
  const entry = new UsageCostLedger().record(usage('usage-unknown', 20, { price: undefined }))
  assert.deepEqual(entry.cost, { status: 'unknown' })
  assert.deepEqual(entry.ttft, { status: 'unknown' })
  assert(!JSON.stringify(entry).includes('"usd":0'))
  assert(!JSON.stringify(entry).includes('"milliseconds":0'))
})

test('observer failure never throws into the caller outcome', async () => {
  const recorder = new TelemetryRecorder({ export: () => { throw new Error('export down') } })
  const delivered = await recorder.record({
    kind: 'attempt_started',
    eventId: 'trace-1',
    identity: identity(),
    occurredAtMs: 100,
    retryOrdinal: 0,
  })
  assert.equal(delivered, false)
  assert.equal(recorder.report().observerFailureCount, 1)
})

test('fixed telemetry schema does not carry prompt, tool result or secret values', async () => {
  const exported: unknown[] = []
  const recorder = new TelemetryRecorder({ export: event => { exported.push(event) } })
  await recorder.record({
    kind: 'tool_finished',
    eventId: 'trace-tool-1',
    runId: 'run-1',
    toolCallId: 'call-1',
    occurredAtMs: 100,
    outcome: 'succeeded',
    durationMs: 20,
  })
  const serialized = JSON.stringify(exported)
  for (const forbidden of ['user prompt value', 'tool result value', 'secret-key-value']) {
    assert(!serialized.includes(forbidden))
  }
  assert(!/prompt|toolResult|secret/i.test(serialized))
})

test('evaluation records bind rubric version and are idempotent', () => {
  const ledger = new EvaluationLedger()
  const record = {
    eventId: 'eval-event-1',
    runId: 'run-1',
    evaluationId: 'eval-1',
    rubricId: 'answer-quality',
    rubricVersion: 2,
    evaluatorVersion: 'judge-3',
    outcome: 'passed' as const,
    dimensions: [{ name: 'correctness' as const, score: 0.9, passed: true }],
    recordedAtMs: 300,
  }
  assert.strictEqual(ledger.record(record), ledger.record(record))
  assert.throws(() => ledger.record({ ...record, outcome: 'failed' }), EventCollisionError)
})

test('reservations prevent token, cost and concurrency oversubscription', async () => {
  const governor = new TenantGovernor({
    acme: { maxTokensPerWindow: 100, maxCostUsdPerWindow: 1, maxConcurrency: 1, maxQueueSize: 2 },
  }, () => 200)
  await governor.reserve({ tenantId: 'acme', reservationId: 'r1', estimatedTokens: 70, estimatedCostUsd: 0.7, requestedAtMs: 100 })
  const queued = governor.reserve({ tenantId: 'acme', reservationId: 'r2', estimatedTokens: 40, estimatedCostUsd: 0.4, requestedAtMs: 101 })
  assert.deepEqual(governor.report('acme'), {
    tenantId: 'acme', activeConcurrency: 1, queueDepth: 1,
    reservedTokens: 70, reservedCostUsd: 0.7, consumedTokens: 0, consumedCostUsd: 0,
  })
  governor.cancel('acme', 'r1')
  assert.equal((await queued).reservationId, 'r2')
})

test('one tenant has a bounded FIFO queue', async () => {
  const governor = new TenantGovernor({
    noisy: { maxTokensPerWindow: 100, maxCostUsdPerWindow: 10, maxConcurrency: 1, maxQueueSize: 1 },
  })
  await governor.reserve({ tenantId: 'noisy', reservationId: 'active', estimatedTokens: 1, estimatedCostUsd: 0.1, requestedAtMs: 1 })
  const queued = governor.reserve({ tenantId: 'noisy', reservationId: 'queued', estimatedTokens: 1, estimatedCostUsd: 0.1, requestedAtMs: 2 })
  assert.throws(
    () => governor.reserve({ tenantId: 'noisy', reservationId: 'overflow', estimatedTokens: 1, estimatedCostUsd: 0.1, requestedAtMs: 3 }),
    TenantQueueFullError,
  )
  governor.complete('noisy', 'active', 1, 0.1)
  assert.equal((await queued).reservationId, 'queued')
})

test('completion and cancellation release concurrency explicitly', async () => {
  const governor = new TenantGovernor({
    team: { maxTokensPerWindow: 100, maxCostUsdPerWindow: 10, maxConcurrency: 1, maxQueueSize: 2 },
  })
  await governor.reserve({ tenantId: 'team', reservationId: 'r1', estimatedTokens: 10, estimatedCostUsd: 1, requestedAtMs: 1 })
  const r2 = governor.reserve({ tenantId: 'team', reservationId: 'r2', estimatedTokens: 10, estimatedCostUsd: 1, requestedAtMs: 2 })
  governor.complete('team', 'r1', 8, 0.8)
  await r2
  const cancelled = governor.reserve({ tenantId: 'team', reservationId: 'r3', estimatedTokens: 10, estimatedCostUsd: 1, requestedAtMs: 3 })
  const rejection = cancelled.then(() => undefined, error => error)
  governor.cancel('team', 'r3')
  assert(await rejection instanceof ReservationCancelledError)
  governor.cancel('team', 'r2')
  assert.equal(governor.report('team').activeConcurrency, 0)
})

let passed = 0
for (const [name, body] of tests) {
  await body()
  passed++
  process.stdout.write(`ok ${passed} - ${name}\n`)
}
process.stdout.write(`1..${passed}\n`)
