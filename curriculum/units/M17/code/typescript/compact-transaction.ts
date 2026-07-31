export type CompactMessageKind =
  | 'human'
  | 'assistant'
  | 'tool-use'
  | 'tool-result'
  | 'compact-boundary'
  | 'compact-summary'

export type CompactMessage = Readonly<{
  id: string
  kind: CompactMessageKind
  content: string
  toolUseId?: string
}>

export type CompactSnapshot = Readonly<{
  revision: number
  messages: readonly CompactMessage[]
}>

export type CompactProvenance = Readonly<{
  transactionId: string
  sourceRevision: number
  sourceMessageIds: readonly string[]
  retainedMessageIds: readonly string[]
  boundaryId: string
  summaryId: string
}>

export type CompactPlan = Readonly<{
  expectedRevision: number
  original: readonly CompactMessage[]
  replacement: readonly CompactMessage[]
  provenance: CompactProvenance
}>

export type CompactJournalRecord = Readonly<{
  phase: 'prepared' | 'committed'
  original: readonly CompactMessage[]
  replacement: readonly CompactMessage[]
  provenance: CompactProvenance
}>

export type CompactRecoveryReport = Readonly<{
  status: 'restored' | 'fell_back' | 'repair_required'
  transactionId?: string
  sourceRevision: number
  targetRevision?: number
  sourceCount: number
  restoredCount: number
  reason?:
    | 'no_record'
    | 'prepared_only'
    | 'missing_boundary'
    | 'missing_summary'
    | 'malformed_provenance'
}>

export interface CompactSummarizer {
  summarize(messages: readonly CompactMessage[], signal: AbortSignal): Promise<string>
}

export interface CompactJournal {
  append(record: CompactJournalRecord): void
  records(): readonly CompactJournalRecord[]
}

export class CompactCancelledError extends Error {}
export class StaleCompactRevisionError extends Error {}
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

export class CompactConversationOwner {
  #revision: number
  #messages: readonly CompactMessage[]

  constructor(messages: readonly CompactMessage[], revision = 0) {
    requireRevision(revision)
    validateMessages(messages)
    this.#revision = revision
    this.#messages = freezeMessages(messages)
  }

  snapshot(): CompactSnapshot {
    return Object.freeze({ revision: this.#revision, messages: this.#messages })
  }

  append(expectedRevision: number, messages: readonly CompactMessage[]): CompactSnapshot {
    this.#requireRevision(expectedRevision)
    const replacement = [...this.#messages, ...messages]
    validateMessages(replacement)
    this.#messages = freezeMessages(replacement)
    this.#revision += 1
    return this.snapshot()
  }

  validateReplacement(expectedRevision: number, messages: readonly CompactMessage[]): void {
    this.#requireRevision(expectedRevision)
    validateMessages(messages)
  }

  replace(expectedRevision: number, messages: readonly CompactMessage[]): CompactSnapshot {
    this.validateReplacement(expectedRevision, messages)
    this.#messages = freezeMessages(messages)
    this.#revision += 1
    return this.snapshot()
  }

  #requireRevision(expectedRevision: number): void {
    requireRevision(expectedRevision)
    if (expectedRevision !== this.#revision) {
      throw new StaleCompactRevisionError(
        `stale compact revision ${expectedRevision}; current=${this.#revision}`,
      )
    }
  }
}

export async function prepareCompact(
  snapshot: CompactSnapshot,
  summarizer: CompactSummarizer,
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
  validateMessages(snapshot.messages)

  const retainedStart = retainedStartIndex(snapshot.messages, options.retainLast)
  const retained = snapshot.messages.slice(retainedStart)
  const summarized = snapshot.messages.slice(0, retainedStart)
  if (summarized.length === 0) {
    throw new CompactInvariantError('compact requires at least one summarized message')
  }

  const summary = (await summarizer.summarize(summarized, signal)).trim()
  throwIfCancelled(signal)
  if (!summary) throw new CompactInvariantError('summary must not be empty')

  const boundary: CompactMessage = Object.freeze({
    id: options.boundaryId,
    kind: 'compact-boundary',
    content: 'Conversation compacted',
  })
  const summaryMessage: CompactMessage = Object.freeze({
    id: options.summaryId,
    kind: 'compact-summary',
    content: summary,
  })
  const replacement = freezeMessages([boundary, summaryMessage, ...retained])
  validateMessages(replacement)

  const provenance = deepFreeze({
    transactionId: options.transactionId,
    sourceRevision: snapshot.revision,
    sourceMessageIds: snapshot.messages.map(message => message.id),
    retainedMessageIds: retained.map(message => message.id),
    boundaryId: boundary.id,
    summaryId: summaryMessage.id,
  })
  return deepFreeze({
    expectedRevision: snapshot.revision,
    original: freezeMessages(snapshot.messages),
    replacement,
    provenance,
  })
}

export function commitCompact(
  owner: CompactConversationOwner,
  plan: CompactPlan,
  journal: CompactJournal,
  signal: AbortSignal,
): CompactSnapshot {
  throwIfCancelled(signal)
  validatePlan(plan)
  owner.validateReplacement(plan.expectedRevision, plan.replacement)

  journal.append(
    deepFreeze({
      phase: 'prepared' as const,
      original: plan.original,
      replacement: plan.replacement,
      provenance: plan.provenance,
    }),
  )
  throwIfCancelled(signal)

  // The committed envelope is appended and the in-memory replace occurs in one
  // synchronous turn. A persistent implementation must provide the same owner
  // serialization around these two operations.
  owner.validateReplacement(plan.expectedRevision, plan.replacement)
  journal.append(
    deepFreeze({
      phase: 'committed' as const,
      original: plan.original,
      replacement: plan.replacement,
      provenance: plan.provenance,
    }),
  )
  return owner.replace(plan.expectedRevision, plan.replacement)
}

export function recoverCompact(
  fallback: CompactSnapshot,
  records: readonly CompactJournalRecord[],
): Readonly<{ snapshot: CompactSnapshot; report: CompactRecoveryReport }> {
  const latest = records.at(-1)
  if (!latest) {
    return recoveryResult(fallback, fallback, 'fell_back', 'no_record')
  }

  if (latest.phase !== 'committed') {
    const original = snapshotFromRecord(latest, latest.original)
    return recoveryResult(original, original, 'fell_back', 'prepared_only', latest)
  }

  const validation = validateRecoveryRecord(latest)
  if (validation) {
    const original = snapshotFromRecord(latest, latest.original)
    return recoveryResult(original, original, 'repair_required', validation, latest)
  }

  const restored: CompactSnapshot = Object.freeze({
    revision: latest.provenance.sourceRevision + 1,
    messages: freezeMessages(latest.replacement),
  })
  return recoveryResult(
    snapshotFromRecord(latest, latest.original),
    restored,
    'restored',
    undefined,
    latest,
  )
}

function retainedStartIndex(messages: readonly CompactMessage[], retainLast: number): number {
  let start = Math.max(0, messages.length - retainLast)
  while (
    start > 0 &&
    messages[start]?.kind === 'tool-result' &&
    messages[start - 1]?.kind === 'tool-use' &&
    messages[start]?.toolUseId === messages[start - 1]?.toolUseId
  ) {
    start -= 1
  }
  return start
}

function validatePlan(plan: CompactPlan): void {
  requireRevision(plan.expectedRevision)
  validateMessages(plan.original)
  validateMessages(plan.replacement)
  if (plan.provenance.sourceRevision !== plan.expectedRevision) {
    throw new CompactInvariantError('plan provenance revision mismatch')
  }
  if (!sameIds(plan.original, plan.provenance.sourceMessageIds)) {
    throw new CompactInvariantError('plan source provenance mismatch')
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
    validateMessages(record.original)
    validateMessages(record.replacement)
  } catch {
    return 'malformed_provenance'
  }
  const boundary = record.replacement.find(
    message => message.id === record.provenance.boundaryId,
  )
  if (boundary?.kind !== 'compact-boundary') return 'missing_boundary'
  const summary = record.replacement.find(
    message => message.id === record.provenance.summaryId,
  )
  if (summary?.kind !== 'compact-summary') return 'missing_summary'
  if (
    !sameIds(record.original, record.provenance.sourceMessageIds) ||
    record.provenance.retainedMessageIds.some(
      id => !record.replacement.some(message => message.id === id),
    )
  ) {
    return 'malformed_provenance'
  }
  return undefined
}

function validateMessages(messages: readonly CompactMessage[]): void {
  const ids = new Set<string>()
  let pendingToolUse: string | undefined
  for (const message of messages) {
    requireIdentifier(message.id, 'message id')
    if (ids.has(message.id)) throw new CompactInvariantError(`duplicate id: ${message.id}`)
    ids.add(message.id)
    if (!message.content.trim()) throw new CompactInvariantError(`empty content: ${message.id}`)

    if (message.kind === 'tool-use') {
      if (pendingToolUse) throw new CompactInvariantError('nested unresolved tool use')
      requireIdentifier(message.toolUseId ?? '', 'tool use id')
      pendingToolUse = message.toolUseId
    } else if (message.kind === 'tool-result') {
      if (!pendingToolUse || message.toolUseId !== pendingToolUse) {
        throw new CompactInvariantError(`orphan tool result: ${message.toolUseId ?? ''}`)
      }
      pendingToolUse = undefined
    } else if (pendingToolUse) {
      throw new CompactInvariantError(`missing tool result: ${pendingToolUse}`)
    }
  }
  if (pendingToolUse) throw new CompactInvariantError(`missing tool result: ${pendingToolUse}`)
}

function snapshotFromRecord(
  record: CompactJournalRecord,
  messages: readonly CompactMessage[],
): CompactSnapshot {
  return Object.freeze({
    revision: record.provenance.sourceRevision,
    messages: freezeMessages(messages),
  })
}

function recoveryResult(
  source: CompactSnapshot,
  restored: CompactSnapshot,
  status: CompactRecoveryReport['status'],
  reason?: CompactRecoveryReport['reason'],
  record?: CompactJournalRecord,
): Readonly<{ snapshot: CompactSnapshot; report: CompactRecoveryReport }> {
  return deepFreeze({
    snapshot: restored,
    report: {
      status,
      transactionId: record?.provenance.transactionId,
      sourceRevision: source.revision,
      targetRevision: status === 'restored' ? restored.revision : undefined,
      sourceCount: source.messages.length,
      restoredCount: restored.messages.length,
      reason,
    },
  })
}

function sameIds(messages: readonly CompactMessage[], ids: readonly string[]): boolean {
  return messages.length === ids.length && messages.every((message, index) => message.id === ids[index])
}

function freezeMessages(messages: readonly CompactMessage[]): readonly CompactMessage[] {
  return deepFreeze(structuredClone(messages))
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CompactCancelledError('compact cancelled')
}

function requireIdentifier(value: string, name: string): void {
  if (!value.trim()) throw new CompactInvariantError(`${name} must not be empty`)
}

function requireRevision(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new CompactInvariantError('revision must be a non-negative integer')
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

