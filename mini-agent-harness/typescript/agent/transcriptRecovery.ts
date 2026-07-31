import { DurableScheduler, type DurableSchedulerState } from './workCoordinator.ts'

export type TranscriptRole = 'user' | 'assistant' | 'tool'
export type EffectPhase = 'prepared' | 'attempted' | 'committed'
export type EffectRecoveryStatus = 'prepared' | 'indeterminate' | 'committed'
export type BackgroundPhase = 'started' | 'heartbeat' | 'completed' | 'failed'

type RecordBase = Readonly<{
  schemaVersion: 1
  recordId: string
  sessionId: string
  sequence: number
}>

export type TranscriptMessageRecord = RecordBase & Readonly<{
  type: 'message'
  messageId: string
  parentMessageId: string | null
  role: TranscriptRole
  content?: unknown
  sourceMessageId?: string
  parallelGroupId?: string
  sourceAssistantMessageId?: string
  toolUseIds?: readonly string[]
  toolResultIds?: readonly string[]
}>

export type EffectJournalRecord = RecordBase & Readonly<{
  type: 'effect'
  effectId: string
  toolUseId: string
  idempotencyKey: string
  phase: EffectPhase
}>

export type BackgroundJournalRecord = RecordBase & Readonly<{
  type: 'background'
  executionId: string
  attempt: number
  phase: BackgroundPhase
  restartPolicy: 'resume' | 'manual'
}>

export type SessionJournalRecord = RecordBase & Readonly<{
  type: 'session'
  event: 'created' | 'forked'
  forkedFromSessionId?: string
}>

export type TranscriptRecord =
  | TranscriptMessageRecord
  | EffectJournalRecord
  | BackgroundJournalRecord
  | SessionJournalRecord

export type TranscriptState = Readonly<{
  revision: number
  records: readonly TranscriptRecord[]
}>

export type JsonlRecoveryReport = Readonly<{
  acceptedRecords: number
  malformedLineNumbers: readonly number[]
  partialTailIgnored: boolean
}>

export type EffectRecovery = Readonly<{
  effectId: string
  toolUseId: string
  idempotencyKey: string
  status: EffectRecoveryStatus
}>

export type RecoveryReport = Readonly<{
  sessionId: string
  storeRevision: number
  loadedRecordCount: number
  restoredMessageCount: number
  completeChain: boolean
  duplicateMessageIds: readonly string[]
  cycleMessageIds: readonly string[]
  danglingParentIds: readonly string[]
  recoveredParallelMessageIds: readonly string[]
  unresolvedToolUseIds: readonly string[]
  preparedEffectIds: readonly string[]
  indeterminateEffectIds: readonly string[]
  committedEffectIds: readonly string[]
  orphanedExecutionIds: readonly string[]
  pendingTriggerIds: readonly string[]
}>

export type RecoverySnapshot = Readonly<{
  messages: readonly TranscriptMessageRecord[]
  effects: readonly EffectRecovery[]
  orphanedExecutions: readonly BackgroundJournalRecord[]
  report: RecoveryReport
}>

export type ResumeResult = RecoverySnapshot & Readonly<{
  mode: 'normal' | 'fork'
  sessionId: string
  schedulerState?: DurableSchedulerState
}>

export class TranscriptStore {
  readonly #records: TranscriptRecord[] = []
  readonly #byRecordId = new Map<string, TranscriptRecord>()
  #revision = 0

  constructor(state?: TranscriptState) {
    if (!state) return
    for (const record of state.records) this.append(record)
    this.#revision = state.revision
  }

  get revision(): number {
    return this.#revision
  }

  append(record: TranscriptRecord, expectedRevision = this.#revision): TranscriptRecord {
    if (expectedRevision !== this.#revision) {
      throw new Error(`stale transcript revision: expected ${expectedRevision}, actual ${this.#revision}`)
    }
    const normalized = freezeRecord(record)
    const existing = this.#byRecordId.get(normalized.recordId)
    if (existing) {
      if (stableJson(existing) !== stableJson(normalized)) {
        throw new Error(`record id collision: ${normalized.recordId}`)
      }
      return existing
    }
    this.#records.push(normalized)
    this.#byRecordId.set(normalized.recordId, normalized)
    this.#revision++
    return normalized
  }

  recordsForSession(sessionId: string): readonly TranscriptRecord[] {
    return Object.freeze(this.#records.filter(record => record.sessionId === sessionId))
  }

  exportState(): TranscriptState {
    return Object.freeze({
      revision: this.#revision,
      records: Object.freeze([...this.#records]),
    })
  }
}

export function encodeTranscriptJsonl(state: TranscriptState): string {
  return state.records.map(record => JSON.stringify(record)).join('\n') + (state.records.length ? '\n' : '')
}

export function decodeTranscriptJsonl(input: string): Readonly<{
  store: TranscriptStore
  report: JsonlRecoveryReport
}> {
  const store = new TranscriptStore()
  const malformed: number[] = []
  const lines = input.split('\n')
  const hasTerminalNewline = input.endsWith('\n')
  let partialTailIgnored = false

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!.trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!isTranscriptRecord(parsed)) throw new Error('invalid transcript record')
      store.append(parsed)
    } catch {
      const isPartialTail = index === lines.length - 1 && !hasTerminalNewline
      if (isPartialTail) partialTailIgnored = true
      else malformed.push(index + 1)
    }
  }

  return Object.freeze({
    store,
    report: Object.freeze({
      acceptedRecords: store.exportState().records.length,
      malformedLineNumbers: Object.freeze(malformed),
      partialTailIgnored,
    }),
  })
}

export class RecoveryReducer {
  reduce(
    store: TranscriptStore,
    sessionId: string,
    options: Readonly<{ leafMessageId?: string; pendingTriggerIds?: readonly string[] }> = {},
  ): RecoverySnapshot {
    const records = store.recordsForSession(sessionId)
    const messages = records.filter((record): record is TranscriptMessageRecord => record.type === 'message')
    const byMessageId = new Map<string, TranscriptMessageRecord>()
    const duplicateMessageIds = new Set<string>()
    for (const message of messages) {
      if (byMessageId.has(message.messageId)) {
        duplicateMessageIds.add(message.messageId)
        continue
      }
      byMessageId.set(message.messageId, message)
    }

    const parentIds = new Set(
      [...byMessageId.values()]
        .map(message => message.parentMessageId)
        .filter((id): id is string => id !== null),
    )
    const leaves = [...byMessageId.values()].filter(message => !parentIds.has(message.messageId))
    const leaf = options.leafMessageId
      ? byMessageId.get(options.leafMessageId)
      : latestBySequence(leaves.length ? leaves : [...byMessageId.values()])

    const reverseChain: TranscriptMessageRecord[] = []
    const seen = new Set<string>()
    const cycleMessageIds = new Set<string>()
    const danglingParentIds = new Set<string>()
    let current = leaf
    while (current) {
      if (seen.has(current.messageId)) {
        cycleMessageIds.add(current.messageId)
        break
      }
      seen.add(current.messageId)
      reverseChain.push(current)
      if (!current.parentMessageId) break
      const parent = byMessageId.get(current.parentMessageId)
      if (!parent) {
        danglingParentIds.add(current.parentMessageId)
        break
      }
      current = parent
    }
    reverseChain.reverse()

    const recoveredParallelMessageIds = new Set<string>()
    const expanded = recoverParallelMessages(reverseChain, [...byMessageId.values()], recoveredParallelMessageIds)
    const resultIds = new Set(expanded.flatMap(message => [...(message.toolResultIds ?? [])]))
    const unresolvedToolUseIds = new Set<string>()
    const filtered = expanded.filter(message => {
      const uses = message.toolUseIds ?? []
      if (message.role !== 'assistant' || uses.length === 0) return true
      const unresolved = uses.filter(id => !resultIds.has(id))
      for (const id of unresolved) unresolvedToolUseIds.add(id)
      return unresolved.length !== uses.length
    })

    const effects = reduceEffects(records)
    const orphanedExecutions = reduceBackground(records)
    const report = Object.freeze({
      sessionId,
      storeRevision: store.revision,
      loadedRecordCount: records.length,
      restoredMessageCount: filtered.length,
      completeChain: cycleMessageIds.size === 0 && danglingParentIds.size === 0,
      duplicateMessageIds: sorted(duplicateMessageIds),
      cycleMessageIds: sorted(cycleMessageIds),
      danglingParentIds: sorted(danglingParentIds),
      recoveredParallelMessageIds: sorted(recoveredParallelMessageIds),
      unresolvedToolUseIds: sorted(unresolvedToolUseIds),
      preparedEffectIds: sorted(effects.filter(effect => effect.status === 'prepared').map(effect => effect.effectId)),
      indeterminateEffectIds: sorted(effects.filter(effect => effect.status === 'indeterminate').map(effect => effect.effectId)),
      committedEffectIds: sorted(effects.filter(effect => effect.status === 'committed').map(effect => effect.effectId)),
      orphanedExecutionIds: sorted(orphanedExecutions.map(record => record.executionId)),
      pendingTriggerIds: sorted(options.pendingTriggerIds ?? []),
    } satisfies RecoveryReport)

    return Object.freeze({
      messages: Object.freeze(filtered),
      effects: Object.freeze(effects),
      orphanedExecutions: Object.freeze(orphanedExecutions),
      report,
    })
  }
}

export class ResumeCoordinator {
  readonly #store: TranscriptStore
  readonly #reducer: RecoveryReducer
  readonly #nextId: () => string

  constructor(store: TranscriptStore, options: Readonly<{ nextId?: () => string }> = {}) {
    this.#store = store
    this.#reducer = new RecoveryReducer()
    this.#nextId = options.nextId ?? (() => crypto.randomUUID())
  }

  resume(input: Readonly<{
    sessionId: string
    mode: 'normal' | 'fork'
    leafMessageId?: string
    schedulerState?: DurableSchedulerState
  }>): ResumeResult {
    const schedulerState = input.schedulerState
      ? new DurableScheduler({ state: input.schedulerState }).exportState()
      : undefined
    const pendingTriggerIds = schedulerState?.pending.map(trigger => trigger.triggerId) ?? []
    const source = this.#reducer.reduce(this.#store, input.sessionId, {
      leafMessageId: input.leafMessageId,
      pendingTriggerIds,
    })

    if (input.mode === 'normal') {
      return Object.freeze({ ...source, mode: 'normal', sessionId: input.sessionId, schedulerState })
    }

    const forkSessionId = this.#nextId()
    const messageIds = new Map(source.messages.map(message => [message.messageId, this.#nextId()]))
    this.#store.append(freezeRecord({
      schemaVersion: 1,
      type: 'session',
      recordId: this.#nextId(),
      sessionId: forkSessionId,
      sequence: this.#store.revision + 1,
      event: 'forked',
      forkedFromSessionId: input.sessionId,
    }))
    for (const message of source.messages) {
      this.#store.append(freezeRecord({
        ...message,
        recordId: this.#nextId(),
        sessionId: forkSessionId,
        sequence: this.#store.revision + 1,
        sourceMessageId: message.messageId,
        messageId: messageIds.get(message.messageId)!,
        parentMessageId: message.parentMessageId ? (messageIds.get(message.parentMessageId) ?? null) : null,
        sourceAssistantMessageId: message.sourceAssistantMessageId
          ? messageIds.get(message.sourceAssistantMessageId)
          : undefined,
      }))
    }
    const fork = this.#reducer.reduce(this.#store, forkSessionId, { pendingTriggerIds })
    return Object.freeze({ ...fork, mode: 'fork', sessionId: forkSessionId, schedulerState })
  }
}

function recoverParallelMessages(
  chain: readonly TranscriptMessageRecord[],
  all: readonly TranscriptMessageRecord[],
  recoveredIds: Set<string>,
): TranscriptMessageRecord[] {
  const chainIds = new Set(chain.map(message => message.messageId))
  const result: TranscriptMessageRecord[] = []
  for (const message of chain) {
    result.push(message)
    if (message.role !== 'assistant' || !message.parallelGroupId) continue
    const siblings = all
      .filter(candidate =>
        candidate.messageId !== message.messageId &&
        candidate.parallelGroupId === message.parallelGroupId &&
        candidate.role === 'assistant' &&
        !chainIds.has(candidate.messageId),
      )
      .sort((left, right) => left.sequence - right.sequence)
    const siblingIds = new Set(siblings.map(sibling => sibling.messageId))
    const toolResults = all
      .filter(candidate => candidate.sourceAssistantMessageId && siblingIds.has(candidate.sourceAssistantMessageId))
      .sort((left, right) => left.sequence - right.sequence)
    for (const recovered of [...siblings, ...toolResults]) {
      if (chainIds.has(recovered.messageId)) continue
      chainIds.add(recovered.messageId)
      recoveredIds.add(recovered.messageId)
      result.push(recovered)
    }
  }
  return result
}

function reduceEffects(records: readonly TranscriptRecord[]): EffectRecovery[] {
  const latest = new Map<string, EffectJournalRecord>()
  for (const record of records) {
    if (record.type !== 'effect') continue
    const current = latest.get(record.effectId)
    if (!current || record.sequence > current.sequence) latest.set(record.effectId, record)
  }
  return [...latest.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .map(record => Object.freeze({
      effectId: record.effectId,
      toolUseId: record.toolUseId,
      idempotencyKey: record.idempotencyKey,
      status: record.phase === 'attempted' ? 'indeterminate' : record.phase,
    }))
}

function reduceBackground(records: readonly TranscriptRecord[]): BackgroundJournalRecord[] {
  const latest = new Map<string, BackgroundJournalRecord>()
  for (const record of records) {
    if (record.type !== 'background') continue
    const current = latest.get(record.executionId)
    if (!current || record.sequence > current.sequence) latest.set(record.executionId, record)
  }
  return [...latest.values()]
    .filter(record => record.phase === 'started' || record.phase === 'heartbeat')
    .sort((left, right) => left.sequence - right.sequence)
}

function latestBySequence(messages: readonly TranscriptMessageRecord[]): TranscriptMessageRecord | undefined {
  return messages.reduce<TranscriptMessageRecord | undefined>(
    (latest, message) => !latest || message.sequence > latest.sequence ? message : latest,
    undefined,
  )
}

function freezeRecord<T extends TranscriptRecord>(record: T): T {
  if (!record.recordId.trim() || !record.sessionId.trim()) throw new Error('record and session ids are required')
  if (!Number.isInteger(record.sequence) || record.sequence < 0) throw new Error('record sequence must be non-negative')
  if (record.type === 'message') {
    if (!record.messageId.trim()) throw new Error('message id is required')
    return Object.freeze({
      ...record,
      toolUseIds: record.toolUseIds ? Object.freeze([...record.toolUseIds]) : undefined,
      toolResultIds: record.toolResultIds ? Object.freeze([...record.toolResultIds]) : undefined,
    }) as T
  }
  return Object.freeze({ ...record }) as T
}

function isTranscriptRecord(value: unknown): value is TranscriptRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== 1 || typeof record.recordId !== 'string' || typeof record.sessionId !== 'string') return false
  if (typeof record.sequence !== 'number' || !['message', 'effect', 'background', 'session'].includes(String(record.type))) return false
  if (record.type === 'message') return typeof record.messageId === 'string' && (typeof record.parentMessageId === 'string' || record.parentMessageId === null) && ['user', 'assistant', 'tool'].includes(String(record.role))
  if (record.type === 'effect') return typeof record.effectId === 'string' && typeof record.toolUseId === 'string' && typeof record.idempotencyKey === 'string' && ['prepared', 'attempted', 'committed'].includes(String(record.phase))
  if (record.type === 'background') return typeof record.executionId === 'string' && typeof record.attempt === 'number' && ['started', 'heartbeat', 'completed', 'failed'].includes(String(record.phase)) && ['resume', 'manual'].includes(String(record.restartPolicy))
  return ['created', 'forked'].includes(String(record.event))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function sorted(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].sort())
}
