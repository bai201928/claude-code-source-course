export type ToolCall = Readonly<{ id: string; name: string }>

export type Envelope =
  | Readonly<{
      kind: 'assistant'
      responseId: string
      calls: readonly ToolCall[]
    }>
  | Readonly<{
      kind: 'tool-result'
      callId: string
      content: string
      selfBounded?: boolean
    }>
  | Readonly<{ kind: 'progress'; callId: string; text: string }>
  | Readonly<{ kind: 'attachment'; text: string }>
  | Readonly<{ kind: 'user'; text: string }>

export type AggregateBudgetPolicy = Readonly<{
  historyStart?: number
  maxGroupChars: number
  previewChars: number
}>

export type ReplacementMetadata = Readonly<{
  groupIndex: number
  callId: string
  status: 'new' | 'reapplied'
  originalChars: number
  projectedChars: number
}>

export type GroupBudgetMetadata = Readonly<{
  groupIndex: number
  resultCount: number
  excludedCount: number
  projectedChars: number
  overBudget: boolean
}>

export type BudgetReport = Readonly<{
  sourceCount: number
  selectedCount: number
  omittedBeforeHistoryStart: number
  replacementRevision: number
  newlyReplacedCount: number
  reappliedCount: number
  frozenCount: number
  groups: readonly GroupBudgetMetadata[]
  replacements: readonly ReplacementMetadata[]
  strictValidation: 'passed'
}>

export type LedgerSnapshot = Readonly<{
  revision: number
  seenIds: ReadonlySet<string>
  replacements: ReadonlyMap<string, string>
}>

export type LedgerCommit = Readonly<{
  expectedRevision: number
  seenIds: ReadonlySet<string>
  replacements: ReadonlyMap<string, string>
}>

export type ProjectionPlan = Readonly<{
  messages: readonly Envelope[]
  report: BudgetReport
  ledgerCommit: LedgerCommit
}>

export class ContextProjectionError extends Error {}
export class StaleReplacementRevisionError extends Error {}

export class ResultBudgetLedger {
  #revision = 0
  readonly #seenIds = new Set<string>()
  readonly #replacements = new Map<string, string>()

  snapshot(): LedgerSnapshot {
    return Object.freeze({
      revision: this.#revision,
      seenIds: new Set(this.#seenIds),
      replacements: new Map(this.#replacements),
    })
  }

  commit(change: LedgerCommit): number {
    if (change.expectedRevision !== this.#revision) {
      throw new StaleReplacementRevisionError(
        `replacement revision ${change.expectedRevision} is stale; current=${this.#revision}`,
      )
    }
    let changed = false
    for (const id of change.seenIds) {
      if (!this.#seenIds.has(id)) {
        this.#seenIds.add(id)
        changed = true
      }
    }
    for (const [id, replacement] of change.replacements) {
      if (this.#replacements.get(id) !== replacement) {
        this.#replacements.set(id, replacement)
        changed = true
      }
    }
    if (changed) this.#revision += 1
    return this.#revision
  }
}

type Candidate = Readonly<{
  messageIndex: number
  callId: string
  content: string
  selfBounded: boolean
}>

export function planAggregateProjection(
  source: readonly Envelope[],
  ledger: LedgerSnapshot,
  policy: AggregateBudgetPolicy,
): ProjectionPlan {
  validatePolicy(source, policy)
  const historyStart = policy.historyStart ?? 0
  const selected = source.slice(historyStart)
  const projected = [...selected]
  const seenDelta = new Set<string>()
  const replacementDelta = new Map<string, string>()
  const replacementMetadata: ReplacementMetadata[] = []
  const groupMetadata: GroupBudgetMetadata[] = []
  let newlyReplacedCount = 0
  let reappliedCount = 0
  let frozenCount = 0

  const groups = collectFinalUserGroups(selected)
  groups.forEach((group, groupIndex) => {
    const fresh: Candidate[] = []
    let excludedCount = 0

    for (const candidate of group) {
      const priorReplacement = ledger.replacements.get(candidate.callId)
      if (priorReplacement !== undefined) {
        projected[candidate.messageIndex] = replaceResult(
          selected[candidate.messageIndex]!,
          priorReplacement,
        )
        replacementMetadata.push({
          groupIndex,
          callId: candidate.callId,
          status: 'reapplied',
          originalChars: candidate.content.length,
          projectedChars: priorReplacement.length,
        })
        reappliedCount += 1
      } else if (ledger.seenIds.has(candidate.callId)) {
        frozenCount += 1
      } else if (candidate.selfBounded) {
        seenDelta.add(candidate.callId)
        excludedCount += 1
      } else {
        fresh.push(candidate)
      }
    }

    let projectedChars = group.reduce((total, candidate) => {
      const message = projected[candidate.messageIndex]
      return total + (message?.kind === 'tool-result' ? message.content.length : 0)
    }, 0)

    const remainingFresh = [...fresh]
    while (projectedChars > policy.maxGroupChars && remainingFresh.length > 0) {
      const ranked = remainingFresh
        .map(candidate => {
          const replacement = buildPreview(candidate, policy.previewChars)
          return {
            candidate,
            replacement,
            reduction: candidate.content.length - replacement.length,
          }
        })
        .sort(
          (a, b) =>
            b.reduction - a.reduction ||
            a.candidate.callId.localeCompare(b.candidate.callId),
        )
      const choice = ranked[0]
      if (!choice || choice.reduction <= 0) break
      const index = remainingFresh.findIndex(
        candidate => candidate.callId === choice.candidate.callId,
      )
      remainingFresh.splice(index, 1)
      projected[choice.candidate.messageIndex] = replaceResult(
        selected[choice.candidate.messageIndex]!,
        choice.replacement,
      )
      projectedChars -= choice.reduction
      replacementDelta.set(choice.candidate.callId, choice.replacement)
      replacementMetadata.push({
        groupIndex,
        callId: choice.candidate.callId,
        status: 'new',
        originalChars: choice.candidate.content.length,
        projectedChars: choice.replacement.length,
      })
      newlyReplacedCount += 1
    }

    for (const candidate of fresh) seenDelta.add(candidate.callId)
    groupMetadata.push({
      groupIndex,
      resultCount: group.length,
      excludedCount,
      projectedChars,
      overBudget: projectedChars > policy.maxGroupChars,
    })
  })

  assertStrictPairing(projected)
  const willChange = seenDelta.size > 0 || replacementDelta.size > 0
  return deepFreeze({
    messages: projected,
    report: {
      sourceCount: source.length,
      selectedCount: selected.length,
      omittedBeforeHistoryStart: historyStart,
      replacementRevision: ledger.revision + (willChange ? 1 : 0),
      newlyReplacedCount,
      reappliedCount,
      frozenCount,
      groups: groupMetadata,
      replacements: replacementMetadata,
      strictValidation: 'passed' as const,
    },
    ledgerCommit: {
      expectedRevision: ledger.revision,
      seenIds: seenDelta,
      replacements: replacementDelta,
    },
  })
}

export function projectAndCommit(
  source: readonly Envelope[],
  ledger: ResultBudgetLedger,
  policy: AggregateBudgetPolicy,
): ProjectionPlan {
  const plan = planAggregateProjection(source, ledger.snapshot(), policy)
  const revision = ledger.commit(plan.ledgerCommit)
  return deepFreeze({
    ...plan,
    report: { ...plan.report, replacementRevision: revision },
  })
}

export function applyPerResultPreview(
  source: readonly Envelope[],
  maxResultChars: number,
  previewChars: number,
): readonly Envelope[] {
  if (!Number.isInteger(maxResultChars) || maxResultChars < 1) {
    throw new ContextProjectionError('maxResultChars must be a positive integer')
  }
  const result = source.map(message => {
    if (
      message.kind !== 'tool-result' ||
      message.selfBounded ||
      message.content.length <= maxResultChars
    ) return message
    return replaceResult(message, buildPreview({
      messageIndex: 0,
      callId: message.callId,
      content: message.content,
      selfBounded: false,
    }, previewChars))
  })
  assertStrictPairing(result)
  return deepFreeze(result)
}

export function naiveGlobalSuffix(
  source: readonly Envelope[],
  maxChars: number,
): readonly Envelope[] {
  let used = 0
  let start = source.length
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const size = envelopeChars(source[index]!)
    if (used + size > maxChars) break
    used += size
    start = index
  }
  const selected = source.slice(start)
  assertStrictPairing(selected)
  return selected
}

export function totalToolResultChars(messages: readonly Envelope[]): number {
  return messages.reduce(
    (total, message) =>
      total + (message.kind === 'tool-result' ? message.content.length : 0),
    0,
  )
}

export function assertStrictPairing(messages: readonly Envelope[]): void {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of messages) {
    if (message.kind === 'assistant') {
      for (const call of message.calls) {
        if (calls.has(call.id)) {
          throw new ContextProjectionError(`duplicate tool use id: ${call.id}`)
        }
        calls.add(call.id)
      }
    } else if (message.kind === 'tool-result') {
      if (!calls.has(message.callId) || results.has(message.callId)) {
        throw new ContextProjectionError(
          `orphan or duplicate tool result: ${message.callId}`,
        )
      }
      results.add(message.callId)
    }
  }
  const missing = [...calls].filter(id => !results.has(id))
  if (missing.length > 0) {
    throw new ContextProjectionError(`missing tool results: ${missing.join(',')}`)
  }
}

function collectFinalUserGroups(messages: readonly Envelope[]): Candidate[][] {
  const groups: Candidate[][] = []
  let current: Candidate[] = []
  const seenResponseIds = new Set<string>()
  const flush = () => {
    if (current.length > 0) groups.push(current)
    current = []
  }

  messages.forEach((message, messageIndex) => {
    if (message.kind === 'tool-result') {
      current.push({
        messageIndex,
        callId: message.callId,
        content: message.content,
        selfBounded: message.selfBounded ?? false,
      })
    } else if (
      message.kind === 'assistant' &&
      !seenResponseIds.has(message.responseId)
    ) {
      flush()
      seenResponseIds.add(message.responseId)
    }
  })
  flush()
  return groups
}

function buildPreview(candidate: Candidate, previewChars: number): string {
  const prefix = candidate.content.slice(0, previewChars)
  return `[tool result ${candidate.callId} preview: ${candidate.content.length} chars; prefix=${JSON.stringify(prefix)}]`
}

function replaceResult(message: Envelope, content: string): Envelope {
  if (message.kind !== 'tool-result') {
    throw new ContextProjectionError('replacement target is not a tool result')
  }
  return Object.freeze({ ...message, content })
}

function envelopeChars(message: Envelope): number {
  switch (message.kind) {
    case 'assistant':
      return message.calls.reduce((total, call) => total + call.id.length + call.name.length, 0)
    case 'tool-result':
      return message.content.length
    case 'progress':
    case 'attachment':
    case 'user':
      return message.text.length
  }
}

function validatePolicy(
  source: readonly Envelope[],
  policy: AggregateBudgetPolicy,
): void {
  const historyStart = policy.historyStart ?? 0
  if (
    !Number.isInteger(historyStart) ||
    historyStart < 0 ||
    historyStart > source.length
  ) {
    throw new ContextProjectionError('historyStart is outside the source')
  }
  if (!Number.isInteger(policy.maxGroupChars) || policy.maxGroupChars < 1) {
    throw new ContextProjectionError('maxGroupChars must be a positive integer')
  }
  if (!Number.isInteger(policy.previewChars) || policy.previewChars < 0) {
    throw new ContextProjectionError('previewChars must be a non-negative integer')
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.isFrozen(value) ? value : Object.freeze(value)
}
