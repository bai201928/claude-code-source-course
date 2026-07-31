export type ProtocolRange = Readonly<{ min: number; max: number }>

export type ReleaseManifest = Readonly<{
  releaseId: string
  binaryVersion: string
  protocol: ProtocolRange
  readableSchemaVersions: readonly number[]
  writeSchemaVersion: number
  policyRevision: number
  featureRevision: number
}>

export type RolloutStage = Readonly<{
  name: string
  trafficPercent: number
  minSamples: number
}>

export type SloPolicy = Readonly<{
  minSuccessRate: number
  maxP95LatencyMs: number
  maxObserverDropRate: number
  maxUnknownCostRate: number
}>

export type SliWindow = Readonly<{
  sampleCount: number
  successRate: number
  p95LatencyMs: number
  observerDropRate: number
  unknownCostRate: number
}>

export type WorkerDependencies = Readonly<{
  transcriptStore: boolean
  workQueue: boolean
  policySource: boolean
  quotaStore: boolean
}>

export type WorkerRegistration = Readonly<{
  workerId: string
  releaseId: string
  protocolVersion: number
  readableSchemaVersions: readonly number[]
  writeSchemaVersion: number
  policyRevision: number
  featureRevision: number
  dependencies: WorkerDependencies
}>

export type WorkerStatus = 'ready' | 'draining' | 'drained' | 'unhealthy'

export type WorkerReport = Readonly<{
  workerId: string
  releaseId: string
  status: WorkerStatus
  activeWorkCount: number
  protocolVersion: number
  policyRevision: number
  featureRevision: number
}>

export type ReleaseReport = Readonly<{
  revision: number
  activeReleaseId: string
  candidateReleaseId?: string
  previousReleaseId?: string
  rolloutState: 'idle' | 'prepared' | 'canary' | 'promoted' | 'rolled_back'
  stageName?: string
  trafficPercent: number
  readyActiveWorkers: number
  readyCandidateWorkers: number
  drainingWorkers: number
  activeWorkCount: number
}>

export class StaleReleaseRevisionError extends Error {}
export class ReleaseCompatibilityError extends Error {}
export class WorkerCompatibilityError extends Error {}
export class ReleaseStateError extends Error {}
export class SloViolationError extends Error {}
export class WorkerStateError extends Error {}

type WorkerState = {
  readonly registration: WorkerRegistration
  status: WorkerStatus
  activeWorkCount: number
}

type Rollout = {
  readonly stages: readonly RolloutStage[]
  stageIndex: number
  state: 'prepared' | 'canary'
}

/**
 * In-process release state machine. Real routing, durable leases, orchestration
 * and database migration are adapter responsibilities.
 */
export class ReleaseController {
  #revision = 1
  #active: ReleaseManifest
  #candidate: ReleaseManifest | undefined
  #previous: ReleaseManifest | undefined
  #rollout: Rollout | undefined
  #terminalState: 'idle' | 'promoted' | 'rolled_back' = 'idle'
  readonly #workers = new Map<string, WorkerState>()
  readonly #slo: SloPolicy

  constructor(active: ReleaseManifest, slo: SloPolicy) {
    validateManifest(active)
    validateSlo(slo)
    this.#active = freeze(active)
    this.#slo = freeze(slo)
  }

  prepare(
    expectedRevision: number,
    candidate: ReleaseManifest,
    stages: readonly RolloutStage[],
  ): ReleaseReport {
    this.#expectRevision(expectedRevision)
    if (this.#candidate || this.#rollout) throw new ReleaseStateError('a rollout is already active')
    validateManifest(candidate)
    validateStages(stages)
    this.#validateReleaseCompatibility(this.#active, candidate)
    this.#candidate = freeze(candidate)
    this.#rollout = { stages: freeze(stages), stageIndex: -1, state: 'prepared' }
    this.#terminalState = 'idle'
    this.#revision++
    return this.report()
  }

  registerWorker(registration: WorkerRegistration): WorkerReport {
    if (this.#workers.has(registration.workerId)) {
      throw new WorkerStateError(`duplicate worker id: ${registration.workerId}`)
    }
    const manifest = this.#manifestFor(registration.releaseId)
    validateWorker(registration, manifest)
    const healthy = Object.values(registration.dependencies).every(Boolean)
    const state: WorkerState = {
      registration: freeze(registration),
      status: healthy ? 'ready' : 'unhealthy',
      activeWorkCount: 0,
    }
    this.#workers.set(registration.workerId, state)
    return workerReport(state)
  }

  beginCanary(expectedRevision: number): ReleaseReport {
    this.#expectRevision(expectedRevision)
    if (!this.#candidate || !this.#rollout || this.#rollout.state !== 'prepared') {
      throw new ReleaseStateError('no prepared rollout')
    }
    if (this.#readyWorkers(this.#candidate.releaseId) === 0) {
      throw new ReleaseStateError('candidate has no ready worker')
    }
    if (this.#readyWorkers(this.#active.releaseId) === 0) {
      throw new ReleaseStateError('active release has no ready worker')
    }
    this.#rollout.stageIndex = 0
    this.#rollout.state = 'canary'
    this.#revision++
    return this.report()
  }

  selectRelease(stableBucket: number): string {
    if (!Number.isInteger(stableBucket) || stableBucket < 0 || stableBucket > 99) {
      throw new Error('stable bucket must be an integer in [0, 99]')
    }
    if (!this.#candidate || !this.#rollout || this.#rollout.state !== 'canary') {
      return this.#active.releaseId
    }
    const stage = this.#rollout.stages[this.#rollout.stageIndex]!
    return stableBucket < stage.trafficPercent
      ? this.#candidate.releaseId
      : this.#active.releaseId
  }

  advance(expectedRevision: number, window: SliWindow): ReleaseReport {
    this.#expectRevision(expectedRevision)
    if (!this.#candidate || !this.#rollout || this.#rollout.state !== 'canary') {
      throw new ReleaseStateError('no canary rollout')
    }
    const stage = this.#rollout.stages[this.#rollout.stageIndex]!
    assertSlo(window, stage, this.#slo)
    if (this.#rollout.stageIndex < this.#rollout.stages.length - 1) {
      this.#rollout.stageIndex++
    } else {
      this.#previous = this.#active
      this.#active = this.#candidate
      this.#candidate = undefined
      this.#rollout = undefined
      this.#terminalState = 'promoted'
    }
    this.#revision++
    return this.report()
  }

  rollback(expectedRevision: number): ReleaseReport {
    this.#expectRevision(expectedRevision)
    if (this.#candidate) {
      this.#markReleaseDraining(this.#candidate.releaseId)
      this.#candidate = undefined
      this.#rollout = undefined
      this.#terminalState = 'rolled_back'
    } else if (this.#previous) {
      if (!this.#previous.readableSchemaVersions.includes(this.#active.writeSchemaVersion)) {
        throw new ReleaseCompatibilityError('previous release cannot read active write schema')
      }
      const rolledRelease = this.#active
      this.#active = this.#previous
      this.#previous = rolledRelease
      this.#markReleaseDraining(rolledRelease.releaseId)
      this.#terminalState = 'rolled_back'
    } else {
      throw new ReleaseStateError('no candidate or previous release to roll back')
    }
    this.#revision++
    return this.report()
  }

  acquireWork(workerId: string, selectedReleaseId: string): WorkerReport {
    const state = this.#worker(workerId)
    if (state.status !== 'ready') throw new WorkerStateError(`worker is not ready: ${workerId}`)
    if (state.registration.releaseId !== selectedReleaseId) {
      throw new WorkerStateError(`worker release does not match selected release: ${workerId}`)
    }
    state.activeWorkCount++
    return workerReport(state)
  }

  completeWork(workerId: string): WorkerReport {
    const state = this.#worker(workerId)
    if (state.activeWorkCount < 1) throw new WorkerStateError(`worker has no active work: ${workerId}`)
    state.activeWorkCount--
    if (state.status === 'draining' && state.activeWorkCount === 0) state.status = 'drained'
    return workerReport(state)
  }

  drainWorker(workerId: string): WorkerReport {
    const state = this.#worker(workerId)
    if (state.status === 'drained') return workerReport(state)
    state.status = state.activeWorkCount === 0 ? 'drained' : 'draining'
    return workerReport(state)
  }

  worker(workerId: string): WorkerReport {
    return workerReport(this.#worker(workerId))
  }

  report(): ReleaseReport {
    const stage = this.#rollout && this.#rollout.stageIndex >= 0
      ? this.#rollout.stages[this.#rollout.stageIndex]
      : undefined
    const rolloutState = this.#rollout?.state ?? this.#terminalState
    return Object.freeze({
      revision: this.#revision,
      activeReleaseId: this.#active.releaseId,
      ...(this.#candidate ? { candidateReleaseId: this.#candidate.releaseId } : {}),
      ...(this.#previous ? { previousReleaseId: this.#previous.releaseId } : {}),
      rolloutState,
      ...(stage ? { stageName: stage.name } : {}),
      trafficPercent: stage?.trafficPercent ?? 0,
      readyActiveWorkers: this.#readyWorkers(this.#active.releaseId),
      readyCandidateWorkers: this.#candidate ? this.#readyWorkers(this.#candidate.releaseId) : 0,
      drainingWorkers: [...this.#workers.values()].filter(worker => worker.status === 'draining').length,
      activeWorkCount: [...this.#workers.values()].reduce((sum, worker) => sum + worker.activeWorkCount, 0),
    })
  }

  #validateReleaseCompatibility(active: ReleaseManifest, candidate: ReleaseManifest): void {
    if (active.releaseId === candidate.releaseId) throw new ReleaseCompatibilityError('release id must change')
    if (!rangesOverlap(active.protocol, candidate.protocol)) {
      throw new ReleaseCompatibilityError('protocol ranges do not overlap')
    }
    if (!candidate.readableSchemaVersions.includes(active.writeSchemaVersion)) {
      throw new ReleaseCompatibilityError('candidate cannot read active write schema')
    }
    if (!active.readableSchemaVersions.includes(candidate.writeSchemaVersion)) {
      throw new ReleaseCompatibilityError('rollback release cannot read candidate write schema')
    }
    if (active.policyRevision !== candidate.policyRevision) {
      throw new ReleaseCompatibilityError('binary canary cannot split policy revision')
    }
  }

  #manifestFor(releaseId: string): ReleaseManifest {
    if (this.#active.releaseId === releaseId) return this.#active
    if (this.#candidate?.releaseId === releaseId) return this.#candidate
    if (this.#previous?.releaseId === releaseId) return this.#previous
    throw new WorkerCompatibilityError(`unknown release: ${releaseId}`)
  }

  #readyWorkers(releaseId: string): number {
    return [...this.#workers.values()].filter(
      worker => worker.registration.releaseId === releaseId && worker.status === 'ready',
    ).length
  }

  #markReleaseDraining(releaseId: string): void {
    for (const worker of this.#workers.values()) {
      if (worker.registration.releaseId === releaseId && worker.status === 'ready') {
        worker.status = worker.activeWorkCount === 0 ? 'drained' : 'draining'
      }
    }
  }

  #worker(workerId: string): WorkerState {
    const worker = this.#workers.get(workerId)
    if (!worker) throw new WorkerStateError(`unknown worker: ${workerId}`)
    return worker
  }

  #expectRevision(expected: number): void {
    if (expected !== this.#revision) {
      throw new StaleReleaseRevisionError(`stale release revision ${expected}; current=${this.#revision}`)
    }
  }
}

function validateManifest(manifest: ReleaseManifest): void {
  requireText(manifest.releaseId, 'releaseId')
  requireText(manifest.binaryVersion, 'binaryVersion')
  validatePositiveInteger(manifest.protocol.min, 'protocol.min')
  validatePositiveInteger(manifest.protocol.max, 'protocol.max')
  if (manifest.protocol.min > manifest.protocol.max) throw new Error('protocol range is inverted')
  if (manifest.readableSchemaVersions.length === 0) throw new Error('at least one readable schema is required')
  for (const version of manifest.readableSchemaVersions) validatePositiveInteger(version, 'readable schema')
  validatePositiveInteger(manifest.writeSchemaVersion, 'writeSchemaVersion')
  validatePositiveInteger(manifest.policyRevision, 'policyRevision')
  validatePositiveInteger(manifest.featureRevision, 'featureRevision')
  if (!manifest.readableSchemaVersions.includes(manifest.writeSchemaVersion)) {
    throw new Error('release must read its own write schema')
  }
}

function validateWorker(worker: WorkerRegistration, manifest: ReleaseManifest): void {
  requireText(worker.workerId, 'workerId')
  if (worker.protocolVersion < manifest.protocol.min || worker.protocolVersion > manifest.protocol.max) {
    throw new WorkerCompatibilityError('worker protocol is outside release range')
  }
  if (worker.writeSchemaVersion !== manifest.writeSchemaVersion) {
    throw new WorkerCompatibilityError('worker write schema does not match manifest')
  }
  if (!manifest.readableSchemaVersions.every(version => worker.readableSchemaVersions.includes(version))) {
    throw new WorkerCompatibilityError('worker cannot read every manifest schema')
  }
  if (worker.policyRevision !== manifest.policyRevision) {
    throw new WorkerCompatibilityError('worker policy revision does not match manifest')
  }
  if (worker.featureRevision !== manifest.featureRevision) {
    throw new WorkerCompatibilityError('worker feature revision does not match manifest')
  }
}

function validateStages(stages: readonly RolloutStage[]): void {
  if (stages.length === 0) throw new Error('rollout needs at least one stage')
  let previous = 0
  for (const stage of stages) {
    requireText(stage.name, 'stage.name')
    if (!Number.isInteger(stage.trafficPercent) || stage.trafficPercent <= previous || stage.trafficPercent > 100) {
      throw new Error('traffic stages must increase to at most 100')
    }
    validatePositiveInteger(stage.minSamples, 'stage.minSamples')
    previous = stage.trafficPercent
  }
  if (previous !== 100) throw new Error('last rollout stage must be 100 percent')
}

function validateSlo(slo: SloPolicy): void {
  validateRatio(slo.minSuccessRate, 'minSuccessRate')
  validateRatio(slo.maxObserverDropRate, 'maxObserverDropRate')
  validateRatio(slo.maxUnknownCostRate, 'maxUnknownCostRate')
  if (!Number.isFinite(slo.maxP95LatencyMs) || slo.maxP95LatencyMs <= 0) {
    throw new Error('maxP95LatencyMs must be positive')
  }
}

function assertSlo(window: SliWindow, stage: RolloutStage, slo: SloPolicy): void {
  if (
    window.sampleCount < stage.minSamples
    || window.successRate < slo.minSuccessRate
    || window.p95LatencyMs > slo.maxP95LatencyMs
    || window.observerDropRate > slo.maxObserverDropRate
    || window.unknownCostRate > slo.maxUnknownCostRate
  ) {
    throw new SloViolationError(`SLO rejected rollout stage: ${stage.name}`)
  }
}

function rangesOverlap(left: ProtocolRange, right: ProtocolRange): boolean {
  return left.min <= right.max && right.min <= left.max
}

function workerReport(state: WorkerState): WorkerReport {
  return Object.freeze({
    workerId: state.registration.workerId,
    releaseId: state.registration.releaseId,
    status: state.status,
    activeWorkCount: state.activeWorkCount,
    protocolVersion: state.registration.protocolVersion,
    policyRevision: state.registration.policyRevision,
    featureRevision: state.registration.featureRevision,
  })
}

function validateRatio(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be in [0, 1]`)
}

function validatePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
}

function requireText(value: string, name: string): void {
  if (value.trim() === '') throw new Error(`${name} must not be empty`)
}

function freeze<T>(value: T): T {
  const clone = structuredClone(value)
  return deepFreeze(clone)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
