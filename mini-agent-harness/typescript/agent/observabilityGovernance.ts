export type AttemptRoute = 'primary' | 'retry' | 'fallback'

export type AttemptIdentity = Readonly<{
  runId: string
  requestId: string
  attemptId: string
  route: AttemptRoute
}>

export type TelemetryEvent =
  | Readonly<{
      kind: 'attempt_started'
      eventId: string
      identity: AttemptIdentity
      occurredAtMs: number
      retryOrdinal: number
    }>
  | Readonly<{
      kind: 'attempt_finished'
      eventId: string
      identity: AttemptIdentity
      occurredAtMs: number
      outcome: 'succeeded' | 'failed' | 'cancelled'
      durationMs: number
      ttftMs?: number
    }>
  | Readonly<{
      kind: 'tool_finished'
      eventId: string
      runId: string
      toolCallId: string
      occurredAtMs: number
      outcome: 'succeeded' | 'failed' | 'cancelled' | 'denied'
      durationMs: number
    }>

export interface OpenTelemetryPort {
  export(event: TelemetryEvent): void | Promise<void>
}

/** Observer failures are counted and never cross into the run outcome. */
export class TelemetryRecorder {
  #observerFailureCount = 0
  readonly #port: OpenTelemetryPort

  constructor(port: OpenTelemetryPort) {
    this.#port = port
  }

  async record(event: TelemetryEvent): Promise<boolean> {
    try {
      await this.#port.export(deepFreeze(structuredClone(event)))
      return true
    } catch {
      this.#observerFailureCount++
      return false
    }
  }

  report(): Readonly<{ observerFailureCount: number }> {
    return Object.freeze({ observerFailureCount: this.#observerFailureCount })
  }
}

export type UsageSnapshot = Readonly<{
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}>

export type TokenPrice = Readonly<{
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  cacheReadUsdPerMillion: number
  cacheCreationUsdPerMillion: number
}>

export type UsageCostCommand = Readonly<{
  eventId: string
  identity: AttemptIdentity
  model: string
  priceVersion: string
  capturedAtMs: number
  cumulative: UsageSnapshot
  price?: TokenPrice
  ttftMs?: number
}>

export type CostState =
  | Readonly<{ status: 'known'; usd: number }>
  | Readonly<{ status: 'unknown' }>

export type TtftState =
  | Readonly<{ status: 'observed'; milliseconds: number }>
  | Readonly<{ status: 'unknown' }>

export type UsageCostEntry = Readonly<{
  eventId: string
  identity: AttemptIdentity
  model: string
  priceVersion: string
  capturedAtMs: number
  cumulative: UsageSnapshot
  delta: UsageSnapshot
  cost: CostState
  ttft: TtftState
}>

export class EventCollisionError extends Error {}
export class NonMonotonicUsageError extends Error {}

/** Converts provider cumulative snapshots into attempt-local immutable deltas. */
export class UsageCostLedger {
  readonly #entries: UsageCostEntry[] = []
  readonly #events = new Map<string, Readonly<{ fingerprint: string; entry: UsageCostEntry }>>()
  readonly #lastByAttempt = new Map<string, UsageSnapshot>()

  record(command: UsageCostCommand): UsageCostEntry {
    validateUsageCommand(command)
    const fingerprint = usageFingerprint(command)
    const existing = this.#events.get(command.eventId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new EventCollisionError(`usage event id collision: ${command.eventId}`)
      }
      return existing.entry
    }

    const attemptKey = identityKey(command.identity)
    const previous = this.#lastByAttempt.get(attemptKey) ?? zeroUsage()
    const delta = subtractUsage(command.cumulative, previous)
    const entry: UsageCostEntry = deepFreeze({
      eventId: command.eventId,
      identity: structuredClone(command.identity),
      model: command.model,
      priceVersion: command.priceVersion,
      capturedAtMs: command.capturedAtMs,
      cumulative: structuredClone(command.cumulative),
      delta,
      cost: command.price
        ? { status: 'known', usd: calculateCost(delta, command.price) }
        : { status: 'unknown' },
      ttft: command.ttftMs === undefined
        ? { status: 'unknown' }
        : { status: 'observed', milliseconds: command.ttftMs },
    })
    this.#lastByAttempt.set(attemptKey, entry.cumulative)
    this.#entries.push(entry)
    this.#events.set(command.eventId, Object.freeze({ fingerprint, entry }))
    return entry
  }

  entries(): readonly UsageCostEntry[] {
    return Object.freeze([...this.#entries])
  }

  report(): Readonly<{
    entryCount: number
    knownCostUsd: number
    unknownCostEntryCount: number
    unknownTtftEntryCount: number
  }> {
    return Object.freeze({
      entryCount: this.#entries.length,
      knownCostUsd: this.#entries.reduce(
        (total, entry) => total + (entry.cost.status === 'known' ? entry.cost.usd : 0),
        0,
      ),
      unknownCostEntryCount: this.#entries.filter(entry => entry.cost.status === 'unknown').length,
      unknownTtftEntryCount: this.#entries.filter(entry => entry.ttft.status === 'unknown').length,
    })
  }
}

export type EvaluationDimension = Readonly<{
  name: 'correctness' | 'grounding' | 'safety' | 'efficiency'
  score: number
  passed: boolean
}>

export type EvaluationRecord = Readonly<{
  eventId: string
  runId: string
  evaluationId: string
  rubricId: string
  rubricVersion: number
  evaluatorVersion: string
  outcome: 'passed' | 'failed' | 'inconclusive'
  dimensions: readonly EvaluationDimension[]
  recordedAtMs: number
}>

export class EvaluationLedger {
  readonly #records: EvaluationRecord[] = []
  readonly #fingerprints = new Map<string, string>()

  record(input: EvaluationRecord): EvaluationRecord {
    validateEvaluation(input)
    const frozen = deepFreeze(structuredClone(input))
    const fingerprint = evaluationFingerprint(frozen)
    const existing = this.#fingerprints.get(input.eventId)
    if (existing !== undefined) {
      if (existing !== fingerprint) {
        throw new EventCollisionError(`evaluation event id collision: ${input.eventId}`)
      }
      return this.#records.find(record => record.eventId === input.eventId)!
    }
    this.#fingerprints.set(input.eventId, fingerprint)
    this.#records.push(frozen)
    return frozen
  }

  records(): readonly EvaluationRecord[] {
    return Object.freeze([...this.#records])
  }
}

export type TenantLimit = Readonly<{
  maxTokensPerWindow: number
  maxCostUsdPerWindow: number
  maxConcurrency: number
  maxQueueSize: number
}>

export type ReservationRequest = Readonly<{
  tenantId: string
  reservationId: string
  estimatedTokens: number
  estimatedCostUsd: number
  requestedAtMs: number
}>

export type TenantReservation = ReservationRequest & Readonly<{
  admittedAtMs: number
}>

export type TenantGovernanceReport = Readonly<{
  tenantId: string
  activeConcurrency: number
  queueDepth: number
  reservedTokens: number
  reservedCostUsd: number
  consumedTokens: number
  consumedCostUsd: number
}>

export class UnknownTenantError extends Error {}
export class TenantQueueFullError extends Error {}
export class ReservationTooLargeError extends Error {}
export class ReservationStateError extends Error {}
export class ReservationCancelledError extends Error {}

type QueuedReservation = Readonly<{
  request: ReservationRequest
  resolve: (reservation: TenantReservation) => void
  reject: (error: Error) => void
}>

type TenantState = {
  readonly limit: TenantLimit
  readonly active: Map<string, TenantReservation>
  readonly queue: QueuedReservation[]
  readonly knownIds: Set<string>
  consumedTokens: number
  consumedCostUsd: number
}

/** In-process reference governor. Distributed CAS and cross-node fairness are deferred. */
export class TenantGovernor {
  readonly #states = new Map<string, TenantState>()
  readonly #now: () => number

  constructor(limits: Readonly<Record<string, TenantLimit>>, now: () => number = Date.now) {
    this.#now = now
    for (const [tenantId, limit] of Object.entries(limits)) {
      validateTenantLimit(limit)
      this.#states.set(tenantId, {
        limit: deepFreeze(structuredClone(limit)),
        active: new Map(),
        queue: [],
        knownIds: new Set(),
        consumedTokens: 0,
        consumedCostUsd: 0,
      })
    }
  }

  reserve(input: ReservationRequest): Promise<TenantReservation> {
    validateReservation(input)
    const state = this.#state(input.tenantId)
    if (state.knownIds.has(input.reservationId)) {
      throw new ReservationStateError(`duplicate reservation id: ${input.reservationId}`)
    }
    if (
      input.estimatedTokens > state.limit.maxTokensPerWindow
      || input.estimatedCostUsd > state.limit.maxCostUsdPerWindow
    ) {
      throw new ReservationTooLargeError(`reservation exceeds tenant limit: ${input.reservationId}`)
    }
    state.knownIds.add(input.reservationId)
    if (canAdmit(state, input)) {
      return Promise.resolve(this.#admit(state, input))
    }
    if (state.queue.length >= state.limit.maxQueueSize) {
      state.knownIds.delete(input.reservationId)
      throw new TenantQueueFullError(`tenant queue full: ${input.tenantId}`)
    }
    return new Promise<TenantReservation>((resolve, reject) => {
      state.queue.push(Object.freeze({ request: deepFreeze(structuredClone(input)), resolve, reject }))
    })
  }

  complete(
    tenantId: string,
    reservationId: string,
    actualTokens: number,
    actualCostUsd: number,
  ): TenantGovernanceReport {
    validateAmount(actualTokens, 'actualTokens', true)
    validateAmount(actualCostUsd, 'actualCostUsd')
    const state = this.#state(tenantId)
    if (!state.active.delete(reservationId)) {
      throw new ReservationStateError(`reservation is not active: ${reservationId}`)
    }
    state.consumedTokens += actualTokens
    state.consumedCostUsd += actualCostUsd
    this.#promote(state)
    return reportForTenant(tenantId, state)
  }

  cancel(tenantId: string, reservationId: string): TenantGovernanceReport {
    const state = this.#state(tenantId)
    if (!state.active.delete(reservationId)) {
      const index = state.queue.findIndex(item => item.request.reservationId === reservationId)
      if (index < 0) throw new ReservationStateError(`reservation is not active or queued: ${reservationId}`)
      const [queued] = state.queue.splice(index, 1)
      queued!.reject(new ReservationCancelledError(`reservation cancelled: ${reservationId}`))
    }
    this.#promote(state)
    return reportForTenant(tenantId, state)
  }

  resetBudgetWindow(tenantId: string): TenantGovernanceReport {
    const state = this.#state(tenantId)
    state.consumedTokens = 0
    state.consumedCostUsd = 0
    this.#promote(state)
    return reportForTenant(tenantId, state)
  }

  report(tenantId: string): TenantGovernanceReport {
    return reportForTenant(tenantId, this.#state(tenantId))
  }

  #state(tenantId: string): TenantState {
    const state = this.#states.get(tenantId)
    if (!state) throw new UnknownTenantError(`unknown tenant: ${tenantId}`)
    return state
  }

  #admit(state: TenantState, input: ReservationRequest): TenantReservation {
    const reservation = deepFreeze({ ...structuredClone(input), admittedAtMs: this.#now() })
    state.active.set(input.reservationId, reservation)
    return reservation
  }

  #promote(state: TenantState): void {
    while (state.queue.length > 0 && canAdmit(state, state.queue[0]!.request)) {
      const queued = state.queue.shift()!
      queued.resolve(this.#admit(state, queued.request))
    }
  }
}

function identityKey(identity: AttemptIdentity): string {
  return `${identity.runId}\u0000${identity.requestId}\u0000${identity.attemptId}`
}

function zeroUsage(): UsageSnapshot {
  return Object.freeze({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })
}

function subtractUsage(current: UsageSnapshot, previous: UsageSnapshot): UsageSnapshot {
  const fields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'] as const
  const delta = Object.fromEntries(fields.map(field => {
    if (current[field] < previous[field]) {
      throw new NonMonotonicUsageError(`cumulative usage decreased for ${field}`)
    }
    return [field, current[field] - previous[field]]
  })) as UsageSnapshot
  return Object.freeze(delta)
}

function calculateCost(usage: UsageSnapshot, price: TokenPrice): number {
  return (
    usage.inputTokens * price.inputUsdPerMillion
    + usage.outputTokens * price.outputUsdPerMillion
    + usage.cacheReadTokens * price.cacheReadUsdPerMillion
    + usage.cacheCreationTokens * price.cacheCreationUsdPerMillion
  ) / 1_000_000
}

function usageFingerprint(command: UsageCostCommand): string {
  return JSON.stringify({
    eventId: command.eventId,
    identity: command.identity,
    model: command.model,
    priceVersion: command.priceVersion,
    capturedAtMs: command.capturedAtMs,
    cumulative: command.cumulative,
    price: command.price ?? null,
    ttftMs: command.ttftMs ?? null,
  })
}

function evaluationFingerprint(record: EvaluationRecord): string {
  return JSON.stringify(record)
}

function validateUsageCommand(command: UsageCostCommand): void {
  requireText(command.eventId, 'eventId')
  requireText(command.identity.runId, 'runId')
  requireText(command.identity.requestId, 'requestId')
  requireText(command.identity.attemptId, 'attemptId')
  requireText(command.model, 'model')
  requireText(command.priceVersion, 'priceVersion')
  for (const [name, value] of Object.entries(command.cumulative)) validateAmount(value, name, true)
  if (command.ttftMs !== undefined) validateAmount(command.ttftMs, 'ttftMs')
  if (command.price) {
    for (const [name, value] of Object.entries(command.price)) validateAmount(value, name)
  }
}

function validateEvaluation(record: EvaluationRecord): void {
  requireText(record.eventId, 'eventId')
  requireText(record.runId, 'runId')
  requireText(record.evaluationId, 'evaluationId')
  requireText(record.rubricId, 'rubricId')
  requireText(record.evaluatorVersion, 'evaluatorVersion')
  if (!Number.isInteger(record.rubricVersion) || record.rubricVersion < 1) {
    throw new Error('rubricVersion must be a positive integer')
  }
  for (const dimension of record.dimensions) {
    if (!Number.isFinite(dimension.score)) throw new Error('evaluation score must be finite')
  }
}

function validateTenantLimit(limit: TenantLimit): void {
  validateAmount(limit.maxTokensPerWindow, 'maxTokensPerWindow', true)
  validateAmount(limit.maxCostUsdPerWindow, 'maxCostUsdPerWindow')
  if (!Number.isInteger(limit.maxConcurrency) || limit.maxConcurrency < 1) {
    throw new Error('maxConcurrency must be a positive integer')
  }
  if (!Number.isInteger(limit.maxQueueSize) || limit.maxQueueSize < 0) {
    throw new Error('maxQueueSize must be a non-negative integer')
  }
}

function validateReservation(input: ReservationRequest): void {
  requireText(input.tenantId, 'tenantId')
  requireText(input.reservationId, 'reservationId')
  validateAmount(input.estimatedTokens, 'estimatedTokens', true)
  validateAmount(input.estimatedCostUsd, 'estimatedCostUsd')
}

function validateAmount(value: number, name: string, integer = false): void {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be a non-negative ${integer ? 'integer' : 'number'}`)
  }
}

function requireText(value: string, name: string): void {
  if (value.trim() === '') throw new Error(`${name} must not be empty`)
}

function canAdmit(state: TenantState, input: ReservationRequest): boolean {
  const reservedTokens = [...state.active.values()].reduce((sum, item) => sum + item.estimatedTokens, 0)
  const reservedCost = [...state.active.values()].reduce((sum, item) => sum + item.estimatedCostUsd, 0)
  return state.active.size < state.limit.maxConcurrency
    && state.consumedTokens + reservedTokens + input.estimatedTokens <= state.limit.maxTokensPerWindow
    && state.consumedCostUsd + reservedCost + input.estimatedCostUsd <= state.limit.maxCostUsdPerWindow
}

function reportForTenant(tenantId: string, state: TenantState): TenantGovernanceReport {
  return Object.freeze({
    tenantId,
    activeConcurrency: state.active.size,
    queueDepth: state.queue.length,
    reservedTokens: [...state.active.values()].reduce((sum, item) => sum + item.estimatedTokens, 0),
    reservedCostUsd: [...state.active.values()].reduce((sum, item) => sum + item.estimatedCostUsd, 0),
    consumedTokens: state.consumedTokens,
    consumedCostUsd: state.consumedCostUsd,
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
