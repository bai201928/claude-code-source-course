import { ReleaseController, type ReleaseManifest, type WorkerRegistration } from './releaseControlPlane.ts'

const active: ReleaseManifest = {
  releaseId: 'release-0.6.0',
  binaryVersion: '0.6.0',
  protocol: { min: 1, max: 2 },
  readableSchemaVersions: [1, 2],
  writeSchemaVersion: 1,
  policyRevision: 7,
  featureRevision: 10,
}

const candidate: ReleaseManifest = {
  releaseId: 'release-0.7.0',
  binaryVersion: '0.7.0',
  protocol: { min: 2, max: 3 },
  readableSchemaVersions: [1, 2],
  writeSchemaVersion: 2,
  policyRevision: 7,
  featureRevision: 11,
}

const worker = (workerId: string, release: ReleaseManifest): WorkerRegistration => ({
  workerId,
  releaseId: release.releaseId,
  protocolVersion: release.protocol.max,
  readableSchemaVersions: release.readableSchemaVersions,
  writeSchemaVersion: release.writeSchemaVersion,
  policyRevision: release.policyRevision,
  featureRevision: release.featureRevision,
  dependencies: { transcriptStore: true, workQueue: true, policySource: true, quotaStore: true },
})

const controller = new ReleaseController(active, {
  minSuccessRate: 0.99,
  maxP95LatencyMs: 1_500,
  maxObserverDropRate: 0.01,
  maxUnknownCostRate: 0.02,
})

controller.prepare(1, candidate, [
  { name: 'canary', trafficPercent: 10, minSamples: 10 },
  { name: 'all', trafficPercent: 100, minSamples: 100 },
])
controller.registerWorker(worker('worker-active', active))
controller.registerWorker(worker('worker-candidate', candidate))
controller.beginCanary(2)
controller.advance(3, {
  sampleCount: 10,
  successRate: 1,
  p95LatencyMs: 800,
  observerDropRate: 0,
  unknownCostRate: 0,
})
controller.advance(4, {
  sampleCount: 100,
  successRate: 0.995,
  p95LatencyMs: 900,
  observerDropRate: 0,
  unknownCostRate: 0,
})

process.stdout.write(`${JSON.stringify(controller.report(), null, 2)}\n`)
