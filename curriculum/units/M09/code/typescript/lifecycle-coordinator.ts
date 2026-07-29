export const CLEANUP_TIERS = [
  'critical',
  'resource',
  'best-effort',
] as const

export type CleanupTier = (typeof CLEANUP_TIERS)[number]
export type LifecycleState = 'running' | 'stopping' | 'stopped'
export type CleanupStatus = 'completed' | 'failed' | 'timed-out' | 'skipped'

export type ShutdownRequest = Readonly<{
  reason: string
  exitCode: number
  overallBudgetMs: number
  tierBudgetMs: Readonly<Record<CleanupTier, number>>
}>

export type CleanupResult = Readonly<{
  name: string
  tier: CleanupTier
  status: CleanupStatus
  durationMs: number
  error?: string
}>

export type ShutdownReport = Readonly<{
  reason: string
  exitCode: number
  state: 'stopped'
  recoveryHint?: string
  deadlineExceeded: boolean
  results: readonly CleanupResult[]
  trace: readonly string[]
}>

export type CleanupHandler = (signal: AbortSignal) => Promise<void>

type Registration = Readonly<{
  name: string
  tier: CleanupTier
  handler: CleanupHandler
}>

type MutableResult = {
  name: string
  tier: CleanupTier
  status?: CleanupStatus
  startedAt: number
  durationMs?: number
  error?: string
}

export class LifecycleCoordinator {
  #state: LifecycleState = 'running'
  #registrations = new Map<string, Registration>()
  #shutdownPromise: Promise<ShutdownReport> | undefined
  readonly options: Readonly<{
    prepare?: (request: ShutdownRequest) =>
      | Readonly<{ recoveryHint?: string }>
      | undefined
    onFailsafe?: (request: ShutdownRequest) => void
    now?: () => number
  }>

  constructor(
    options: Readonly<{
      prepare?: (request: ShutdownRequest) =>
        | Readonly<{ recoveryHint?: string }>
        | undefined
      onFailsafe?: (request: ShutdownRequest) => void
      now?: () => number
    }> = {},
  ) {
    this.options = options
  }

  get state(): LifecycleState {
    return this.#state
  }

  register(name: string, tier: CleanupTier, handler: CleanupHandler): () => void {
    requireNonEmpty(name, 'cleanup name')
    if (this.#state !== 'running') {
      throw new Error(`cannot register cleanup while lifecycle is ${this.#state}`)
    }
    if (this.#registrations.has(name)) {
      throw new Error(`cleanup already registered: ${name}`)
    }
    this.#registrations.set(name, Object.freeze({ name, tier, handler }))
    let active = true
    return () => {
      if (!active) return
      active = false
      this.#registrations.delete(name)
    }
  }

  shutdown(request: ShutdownRequest): Promise<ShutdownReport> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    validateRequest(request)
    this.#state = 'stopping'
    this.#shutdownPromise = this.#runShutdown(Object.freeze(request))
    return this.#shutdownPromise
  }

  async #runShutdown(request: ShutdownRequest): Promise<ShutdownReport> {
    const now = this.options.now ?? Date.now
    const startedAt = now()
    const trace: string[] = [`shutdown:start:${request.reason}:${request.exitCode}`]
    let recoveryHint: string | undefined
    try {
      recoveryHint = this.options.prepare?.(request)?.recoveryHint
      trace.push('prepare:completed')
    } catch (error) {
      trace.push(`prepare:failed:${errorMessage(error)}`)
    }

    const snapshot = Object.freeze([...this.#registrations.values()])
    const results: CleanupResult[] = []
    let deadlineExceeded = false
    let processedTierCount = 0

    for (const tier of CLEANUP_TIERS) {
      const elapsed = Math.max(0, now() - startedAt)
      const remaining = request.overallBudgetMs - elapsed
      if (remaining <= 0) {
        deadlineExceeded = true
        break
      }

      const entries = snapshot.filter(entry => entry.tier === tier)
      const budgetMs = Math.min(request.tierBudgetMs[tier], remaining)
      trace.push(`tier:start:${tier}:${budgetMs}`)
      const tierResult = await runTier(entries, tier, budgetMs, now)
      results.push(...tierResult.results)
      trace.push(`tier:end:${tier}:${tierResult.timedOut ? 'timed-out' : 'settled'}`)
      processedTierCount += 1

      if (tierResult.timedOut && budgetMs === remaining) {
        deadlineExceeded = true
        break
      }
    }

    if (deadlineExceeded) {
      for (const tier of CLEANUP_TIERS.slice(processedTierCount)) {
        for (const entry of snapshot.filter(item => item.tier === tier)) {
          results.push(
            Object.freeze({
              name: entry.name,
              tier,
              status: 'skipped',
              durationMs: 0,
            }),
          )
        }
      }
      trace.push('failsafe:deadline-exceeded')
      try {
        this.options.onFailsafe?.(request)
      } catch (error) {
        trace.push(`failsafe:callback-failed:${errorMessage(error)}`)
      }
    }

    this.#state = 'stopped'
    trace.push('shutdown:stopped')
    return Object.freeze({
      reason: request.reason,
      exitCode: request.exitCode,
      state: 'stopped',
      ...(recoveryHint ? { recoveryHint } : {}),
      deadlineExceeded,
      results: Object.freeze(results),
      trace: Object.freeze(trace),
    })
  }
}

async function runTier(
  entries: readonly Registration[],
  tier: CleanupTier,
  budgetMs: number,
  now: () => number,
): Promise<Readonly<{ results: readonly CleanupResult[]; timedOut: boolean }>> {
  if (entries.length === 0) {
    return Object.freeze({ results: Object.freeze([]), timedOut: false })
  }

  const controller = new AbortController()
  const records: MutableResult[] = entries.map(entry => ({
    name: entry.name,
    tier,
    startedAt: now(),
  }))
  const tasks = entries.map((entry, index) =>
    Promise.resolve()
      .then(() => entry.handler(controller.signal))
      .then(
        () => finalize(records[index]!, 'completed', now),
        error => finalize(records[index]!, 'failed', now, errorMessage(error)),
      ),
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const winner = await Promise.race([
    Promise.all(tasks).then(() => 'settled' as const),
    new Promise<'timed-out'>(resolve => {
      timer = setTimeout(() => resolve('timed-out'), budgetMs)
    }),
  ])

  if (timer !== undefined) clearTimeout(timer)
  if (winner === 'timed-out') {
    controller.abort(`cleanup-tier-timeout:${tier}`)
    for (const record of records) {
      if (!record.status) finalize(record, 'timed-out', now)
    }
  }

  return Object.freeze({
    results: Object.freeze(
      records.map(record =>
        Object.freeze({
          name: record.name,
          tier: record.tier,
          status: record.status ?? 'timed-out',
          durationMs: record.durationMs ?? 0,
          ...(record.error ? { error: record.error } : {}),
        }),
      ),
    ),
    timedOut: winner === 'timed-out',
  })
}

function finalize(
  record: MutableResult,
  status: Exclude<CleanupStatus, 'skipped'>,
  now: () => number,
  error?: string,
): void {
  if (record.status) return
  record.status = status
  record.durationMs = Math.max(0, now() - record.startedAt)
  if (error) record.error = error
}

function validateRequest(request: ShutdownRequest): void {
  requireNonEmpty(request.reason, 'shutdown reason')
  if (!Number.isInteger(request.exitCode)) throw new Error('exitCode must be an integer')
  requirePositive(request.overallBudgetMs, 'overallBudgetMs')
  for (const tier of CLEANUP_TIERS) {
    requirePositive(request.tierBudgetMs[tier], `tierBudgetMs.${tier}`)
  }
}

function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim() === '') throw new Error(`${name} must not be empty`)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class SnapshotCleanupRegistry {
  #handlers = new Set<() => Promise<void>>()

  register(handler: () => Promise<void>): () => void {
    this.#handlers.add(handler)
    return () => this.#handlers.delete(handler)
  }

  async run(): Promise<void> {
    await Promise.all([...this.#handlers].map(handler => handler()))
  }
}
