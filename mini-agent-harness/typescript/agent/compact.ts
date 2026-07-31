import {
  ConversationStore,
  MessageInvariantError,
  envelopeId,
  type ConversationRunLease,
  type ConversationSnapshot,
  type DurableMessage,
  type EnvelopeId,
} from '../conversationStore.ts'

export type CompactProvenance = Readonly<{
  transactionId: string
  sourceRevision: number
  sourceMessageIds: readonly EnvelopeId[]
  summarizedMessageIds: readonly EnvelopeId[]
  retainedMessageIds: readonly EnvelopeId[]
  boundaryId: EnvelopeId
  summaryId: EnvelopeId
}>

export type CompactPlan = Readonly<{
  expectedRevision: number
  original: readonly DurableMessage[]
  replacement: readonly DurableMessage[]
  provenance: CompactProvenance
}>

export type CompactJournalRecord = Readonly<{
  phase: 'prepared' | 'committed'
  original: readonly DurableMessage[]
  replacement: readonly DurableMessage[]
  provenance: CompactProvenance
}>

export interface CompactJournal {
  append(record: CompactJournalRecord): void
  records(): readonly CompactJournalRecord[]
}

export interface ConversationSummarizer {
  summarize(messages: readonly DurableMessage[], signal: AbortSignal): Promise<string>
}

export type CompactRecoveryReport = Readonly<{
  status: 'restored' | 'fell_back' | 'repair_required'
  transactionId?: string
  sourceRevision: number
  targetRevision?: number
  sourceCount: number
  summarizedCount: number
  retainedCount: number
  restoredCount: number
  reason?:
    | 'no_record'
    | 'prepared_only'
    | 'missing_boundary'
    | 'missing_summary'
    | 'malformed_provenance'
}>

export type CompactCommitSummary = Readonly<{
  transactionId: string
  sourceRevision: number
  committedRevision: number
  sourceCount: number
  summarizedCount: number
  retainedCount: number
}>

export class CompactCancelledError extends Error {}
export class CompactInvariantError extends Error {}

export class InMemoryCompactJournal implements CompactJournal {
  readonly #records: CompactJournalRecord[] = []
  readonly #afterAppend?: (record: CompactJournalRecord) => void

  constructor(afterAppend?: (record: CompactJournalRecord) => void) {
    this.#afterAppend = afterAppend
  }

  append(record: CompactJournalRecord): void {
    const frozen = deepFreeze(structuredClone(record))
    this.#records.push(frozen)
    this.#afterAppend?.(frozen)
  }

  records(): readonly CompactJournalRecord[] {
    return Object.freeze([...this.#records])
  }
}

export class CompactCoordinator {
  readonly #store: ConversationStore
  readonly #journal: CompactJournal

  constructor(
    store: ConversationStore,
    journal: CompactJournal = new InMemoryCompactJournal(),
  ) {
    this.#store = store
    this.#journal = journal
  }

  async prepare(
    summarizer: ConversationSummarizer,
    options: Readonly<{
      transactionId: string
      boundaryId: string
      summaryId: string
      retainLast: number
    }>,
    signal: AbortSignal,
  ): Promise<CompactPlan> {
    requireIdentifier(options.transactionId, 'transaction id')
    requireIdentifier(options.boundaryId, 'boundary id')
    requireIdentifier(options.summaryId, 'summary id')
    if (!Number.isInteger(options.retainLast) || options.retainLast < 0) {
      throw new CompactInvariantError('retainLast must be a non-negative integer')
    }
    throwIfCancelled(signal)

    const snapshot = this.#store.snapshot()
    const leadingSystemCount = countLeadingSystemMessages(snapshot.messages)
    const retainedStart = findRetainedStart(
      snapshot.messages,
      leadingSystemCount,
      options.retainLast,
      options.boundaryId,
      options.summaryId,
    )
    const summarized = snapshot.messages.slice(leadingSystemCount, retainedStart)
    if (summarized.length === 0) {
      throw new CompactInvariantError('compact requires at least one summarized message')
    }
    const retained = snapshot.messages.slice(retainedStart)
    const summary = (await summarizer.summarize(summarized, signal)).trim()
    throwIfCancelled(signal)
    if (!summary) throw new CompactInvariantError('summary must not be empty')

    const replacement = buildReplacement(
      snapshot.messages.slice(0, leadingSystemCount),
      retained,
      options.boundaryId,
      options.summaryId,
      summary,
    )
    validateRequestReady(replacement)
    const provenance = deepFreeze({
      transactionId: options.transactionId,
      sourceRevision: snapshot.revision,
      sourceMessageIds: snapshot.messages.map(message => message.id),
      summarizedMessageIds: summarized.map(message => message.id),
      retainedMessageIds: retained.map(message => message.id),
      boundaryId: envelopeId(options.boundaryId),
      summaryId: envelopeId(options.summaryId),
    })
    return deepFreeze({
      expectedRevision: snapshot.revision,
      original: snapshot.messages,
      replacement,
      provenance,
    })
  }

  commit(
    plan: CompactPlan,
    runLease: ConversationRunLease,
    signal: AbortSignal,
  ): Readonly<{ snapshot: ConversationSnapshot; summary: CompactCommitSummary }> {
    throwIfCancelled(signal)
    validatePlan(plan)
    requireCurrentRevision(this.#store, plan.expectedRevision)
    validateRequestReady(plan.replacement)

    this.#journal.append({
      phase: 'prepared',
      original: plan.original,
      replacement: plan.replacement,
      provenance: plan.provenance,
    })
    throwIfCancelled(signal)

    // No await occurs between the final revision check, committed envelope and
    // ConversationStore replace. Persistent journal implementations must keep
    // this coordinator as the single writer for the same transaction owner.
    requireCurrentRevision(this.#store, plan.expectedRevision)
    this.#journal.append({
      phase: 'committed',
      original: plan.original,
      replacement: plan.replacement,
      provenance: plan.provenance,
    })
    const snapshot = this.#store.replace(
      plan.expectedRevision,
      plan.replacement,
      runLease,
    )
    return deepFreeze({
      snapshot,
      summary: {
        transactionId: plan.provenance.transactionId,
        sourceRevision: plan.expectedRevision,
        committedRevision: snapshot.revision,
        sourceCount: plan.original.length,
        summarizedCount: plan.provenance.summarizedMessageIds.length,
        retainedCount: plan.provenance.retainedMessageIds.length,
      },
    })
  }

  records(): readonly CompactJournalRecord[] {
    return this.#journal.records()
  }
}

export function recoverCompaction(
  fallback: ConversationSnapshot,
  records: readonly CompactJournalRecord[],
): Readonly<{ messages: readonly DurableMessage[]; report: CompactRecoveryReport }> {
  const latest = records.at(-1)
  if (!latest) {
    return recoveryResult(fallback.messages, fallback.revision, 'fell_back', 'no_record')
  }
  if (latest.phase !== 'committed') {
    return recoveryResult(
      latest.original,
      latest.provenance.sourceRevision,
      'fell_back',
      'prepared_only',
      latest,
    )
  }
  const reason = validateRecoveryRecord(latest)
  if (reason) {
    return recoveryResult(
      latest.original,
      latest.provenance.sourceRevision,
      'repair_required',
      reason,
      latest,
    )
  }
  return recoveryResult(
    latest.replacement,
    latest.provenance.sourceRevision,
    'restored',
    undefined,
    latest,
  )
}

function findRetainedStart(
  messages: readonly DurableMessage[],
  floor: number,
  retainLast: number,
  boundaryId: string,
  summaryId: string,
): number {
  let start = Math.max(floor, messages.length - retainLast)
  while (start >= floor) {
    if (start === floor) break
    const candidate = buildReplacement(
      messages.slice(0, floor),
      messages.slice(start),
      boundaryId,
      summaryId,
      'prepared summary',
    )
    try {
      validateRequestReady(candidate)
      return start
    } catch (error) {
      if (!(error instanceof MessageInvariantError)) throw error
      start -= 1
    }
  }
  return start
}

function buildReplacement(
  leadingSystem: readonly DurableMessage[],
  retained: readonly DurableMessage[],
  boundaryId: string,
  summaryId: string,
  summary: string,
): readonly DurableMessage[] {
  const raw: DurableMessage[] = [
    ...leadingSystem,
    {
      kind: 'system',
      id: envelopeId(boundaryId),
      text: 'Conversation compacted',
    },
    {
      kind: 'system',
      id: envelopeId(summaryId),
      text: summary,
    },
    ...retained,
  ]
  const rebased: DurableMessage[] = []
  let parentId: EnvelopeId | undefined
  for (const message of raw) {
    const next = reparent(message, parentId)
    rebased.push(next)
    parentId = next.id
  }
  return deepFreeze(rebased)
}

function reparent(message: DurableMessage, parentId?: EnvelopeId): DurableMessage {
  const base = { ...structuredClone(message), parentId }
  if (parentId === undefined) delete base.parentId
  return deepFreeze(base) as DurableMessage
}

function validatePlan(plan: CompactPlan): void {
  if (plan.provenance.sourceRevision !== plan.expectedRevision) {
    throw new CompactInvariantError('compact provenance revision mismatch')
  }
  if (!sameIds(plan.original, plan.provenance.sourceMessageIds)) {
    throw new CompactInvariantError('compact source provenance mismatch')
  }
  const reason = validateRecoveryRecord({
    phase: 'committed',
    original: plan.original,
    replacement: plan.replacement,
    provenance: plan.provenance,
  })
  if (reason) throw new CompactInvariantError(reason)
}

function validateRecoveryRecord(
  record: CompactJournalRecord,
): CompactRecoveryReport['reason'] | undefined {
  try {
    validateRequestReady(record.original)
    validateRequestReady(record.replacement)
  } catch {
    return 'malformed_provenance'
  }
  const boundary = record.replacement.find(
    message => message.id === record.provenance.boundaryId,
  )
  if (boundary?.kind !== 'system' || boundary.text !== 'Conversation compacted') {
    return 'missing_boundary'
  }
  const summary = record.replacement.find(
    message => message.id === record.provenance.summaryId,
  )
  if (summary?.kind !== 'system') return 'missing_summary'
  if (
    !sameIds(record.original, record.provenance.sourceMessageIds) ||
    record.provenance.retainedMessageIds.some(
      id => !record.replacement.some(message => message.id === id),
    )
  ) return 'malformed_provenance'
  return undefined
}

function recoveryResult(
  messages: readonly DurableMessage[],
  sourceRevision: number,
  status: CompactRecoveryReport['status'],
  reason?: CompactRecoveryReport['reason'],
  record?: CompactJournalRecord,
): Readonly<{ messages: readonly DurableMessage[]; report: CompactRecoveryReport }> {
  const restored = deepFreeze(structuredClone(messages))
  return deepFreeze({
    messages: restored,
    report: {
      status,
      transactionId: record?.provenance.transactionId,
      sourceRevision,
      targetRevision: status === 'restored' ? sourceRevision + 1 : undefined,
      sourceCount: record?.original.length ?? messages.length,
      summarizedCount: record?.provenance.summarizedMessageIds.length ?? 0,
      retainedCount: record?.provenance.retainedMessageIds.length ?? 0,
      restoredCount: restored.length,
      reason,
    },
  })
}

function validateRequestReady(messages: readonly DurableMessage[]): void {
  const candidate = new ConversationStore(messages)
  candidate.assertRequestReady(candidate.snapshot())
}

function requireCurrentRevision(store: ConversationStore, expected: number): void {
  if (store.revision !== expected) {
    throw new CompactInvariantError(
      `stale compact revision ${expected}; current=${store.revision}`,
    )
  }
}

function countLeadingSystemMessages(messages: readonly DurableMessage[]): number {
  const index = messages.findIndex(message => message.kind !== 'system')
  return index === -1 ? messages.length : index
}

function sameIds(messages: readonly DurableMessage[], ids: readonly EnvelopeId[]): boolean {
  return messages.length === ids.length && messages.every((message, index) => message.id === ids[index])
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CompactCancelledError('compact cancelled')
}

function requireIdentifier(value: string, name: string): void {
  if (!value.trim()) throw new CompactInvariantError(`${name} must not be empty`)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

