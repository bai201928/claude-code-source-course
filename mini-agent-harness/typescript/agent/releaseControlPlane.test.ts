import assert from 'node:assert/strict'
import {
  ReleaseCompatibilityError,
  ReleaseController,
  ReleaseStateError,
  SloViolationError,
  WorkerCompatibilityError,
  WorkerStateError,
  type ReleaseManifest,
  type SliWindow,
  type WorkerRegistration,
} from './releaseControlPlane.ts'

const active = (overrides: Partial<ReleaseManifest> = {}): ReleaseManifest => ({
  releaseId: 'release-1',
  binaryVersion: '0.6.0',
  protocol: { min: 1, max: 2 },
  readableSchemaVersions: [1, 2],
  writeSchemaVersion: 1,
  policyRevision: 7,
  featureRevision: 10,
  ...overrides,
})

const candidate = (overrides: Partial<ReleaseManifest> = {}): ReleaseManifest => ({
  releaseId: 'release-2',
  binaryVersion: '0.7.0',
  protocol: { min: 2, max: 3 },
  readableSchemaVersions: [1, 2],
  writeSchemaVersion: 2,
  policyRevision: 7,
  featureRevision: 11,
  ...overrides,
})

const worker = (
  workerId: string,
  manifest: ReleaseManifest,
  overrides: Partial<WorkerRegistration> = {},
): WorkerRegistration => ({
  workerId,
  releaseId: manifest.releaseId,
  protocolVersion: manifest.protocol.max,
  readableSchemaVersions: manifest.readableSchemaVersions,
  writeSchemaVersion: manifest.writeSchemaVersion,
  policyRevision: manifest.policyRevision,
  featureRevision: manifest.featureRevision,
  dependencies: { transcriptStore: true, workQueue: true, policySource: true, quotaStore: true },
  ...overrides,
})

const stages = [
  { name: 'canary', trafficPercent: 10, minSamples: 10 },
  { name: 'half', trafficPercent: 50, minSamples: 50 },
  { name: 'all', trafficPercent: 100, minSamples: 100 },
] as const

const goodWindow = (sampleCount = 100): SliWindow => ({
  sampleCount,
  successRate: 0.995,
  p95LatencyMs: 900,
  observerDropRate: 0,
  unknownCostRate: 0,
})

const controller = (): ReleaseController => new ReleaseController(active(), {
  minSuccessRate: 0.99,
  maxP95LatencyMs: 1_000,
  maxObserverDropRate: 0.01,
  maxUnknownCostRate: 0.02,
})

const tests: Array<readonly [string, () => void | Promise<void>]> = []
const test = (name: string, body: () => void | Promise<void>) => tests.push([name, body])

test('candidate must read the active write schema', () => {
  const subject = controller()
  assert.throws(
    () => subject.prepare(1, candidate({ readableSchemaVersions: [2] }), stages),
    ReleaseCompatibilityError,
  )
})

test('previous release must read candidate writes during rollback window', () => {
  const subject = new ReleaseController(active({ readableSchemaVersions: [1] }), {
    minSuccessRate: 0.99, maxP95LatencyMs: 1_000, maxObserverDropRate: 0.01, maxUnknownCostRate: 0.02,
  })
  assert.throws(() => subject.prepare(1, candidate(), stages), ReleaseCompatibilityError)
})

test('binary canary cannot silently split policy revision', () => {
  assert.throws(
    () => controller().prepare(1, candidate({ policyRevision: 8 }), stages),
    ReleaseCompatibilityError,
  )
})

test('worker registration fails closed on protocol schema policy and feature mismatch', () => {
  const subject = controller()
  subject.prepare(1, candidate(), stages)
  assert.throws(() => subject.registerWorker(worker('bad-protocol', candidate(), { protocolVersion: 1 })), WorkerCompatibilityError)
  assert.throws(() => subject.registerWorker(worker('bad-schema', candidate(), { writeSchemaVersion: 1 })), WorkerCompatibilityError)
  assert.throws(() => subject.registerWorker(worker('bad-policy', candidate(), { policyRevision: 6 })), WorkerCompatibilityError)
  assert.throws(() => subject.registerWorker(worker('bad-feature', candidate(), { featureRevision: 10 })), WorkerCompatibilityError)
})

test('canary begins only with ready active and candidate workers', () => {
  const subject = controller()
  subject.prepare(1, candidate(), stages)
  subject.registerWorker(worker('active-1', active()))
  assert.throws(() => subject.beginCanary(2), ReleaseStateError)
  subject.registerWorker(worker('candidate-bad', candidate(), {
    dependencies: { transcriptStore: true, workQueue: false, policySource: true, quotaStore: true },
  }))
  assert.throws(() => subject.beginCanary(2), ReleaseStateError)
  subject.registerWorker(worker('candidate-1', candidate()))
  assert.equal(subject.beginCanary(2).trafficPercent, 10)
})

test('stable bucket selects the stage release deterministically', () => {
  const subject = controller()
  subject.prepare(1, candidate(), stages)
  subject.registerWorker(worker('active-1', active()))
  subject.registerWorker(worker('candidate-1', candidate()))
  subject.beginCanary(2)
  assert.equal(subject.selectRelease(0), 'release-2')
  assert.equal(subject.selectRelease(9), 'release-2')
  assert.equal(subject.selectRelease(10), 'release-1')
  assert.equal(subject.selectRelease(99), 'release-1')
})

test('SLO violations block stage advancement', () => {
  const subject = controller()
  subject.prepare(1, candidate(), stages)
  subject.registerWorker(worker('active-1', active()))
  subject.registerWorker(worker('candidate-1', candidate()))
  subject.beginCanary(2)
  assert.throws(() => subject.advance(3, { ...goodWindow(10), successRate: 0.8 }), SloViolationError)
  assert.equal(subject.report().trafficPercent, 10)
})

test('healthy windows advance and promote the candidate', () => {
  const subject = controller()
  subject.prepare(1, candidate(), stages)
  subject.registerWorker(worker('active-1', active()))
  subject.registerWorker(worker('candidate-1', candidate()))
  subject.beginCanary(2)
  subject.advance(3, goodWindow(10))
  subject.advance(4, goodWindow(50))
  const promoted = subject.advance(5, goodWindow(100))
  assert.equal(promoted.activeReleaseId, 'release-2')
  assert.equal(promoted.previousReleaseId, 'release-1')
  assert.equal(promoted.rolloutState, 'promoted')
})

test('draining rejects new work and completes already-owned work', () => {
  const subject = controller()
  subject.registerWorker(worker('active-1', active()))
  subject.acquireWork('active-1', 'release-1')
  assert.equal(subject.drainWorker('active-1').status, 'draining')
  assert.throws(() => subject.acquireWork('active-1', 'release-1'), WorkerStateError)
  assert.equal(subject.completeWork('active-1').status, 'drained')
})

test('rollback restores routing and drains promoted workers without claiming effect rollback', () => {
  const subject = controller()
  subject.prepare(1, candidate(), stages)
  subject.registerWorker(worker('active-1', active()))
  subject.registerWorker(worker('candidate-1', candidate()))
  subject.beginCanary(2)
  subject.advance(3, goodWindow(10))
  subject.advance(4, goodWindow(50))
  subject.advance(5, goodWindow(100))
  const rolled = subject.rollback(6)
  assert.equal(rolled.activeReleaseId, 'release-1')
  assert.equal(rolled.rolloutState, 'rolled_back')
  assert.equal(subject.worker('candidate-1').status, 'drained')
  assert(!/prompt|toolInput|toolResult|secret/i.test(JSON.stringify(rolled)))
})

let passed = 0
for (const [name, body] of tests) {
  await body()
  passed++
  process.stdout.write(`ok ${passed} - ${name}\n`)
}
process.stdout.write(`1..${passed}\n`)
