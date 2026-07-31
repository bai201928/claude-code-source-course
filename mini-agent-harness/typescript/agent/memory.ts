export type MemoryStatus =
  | 'candidate'
  | 'accepted'
  | 'rejected'
  | 'superseded'
  | 'expired'

export type MemoryScope = Readonly<{
  kind: 'project' | 'session'
  key: string
}>

export type MemoryProvenance = Readonly<{
  sourceKind: 'user' | 'assistant' | 'tool' | 'system'
  sourceIds: readonly string[]
  capturedAt: number
}>

export type MemoryRecord = Readonly<{
  id: string
  key: string
  content: string
  scope: MemoryScope
  provenance: MemoryProvenance
  status: MemoryStatus
  createdAt: number
  updatedAt: number
  retentionMs?: number
  expiresAt?: number
}>

export type MemorySnapshot = Readonly<{
  revision: number
  records: readonly MemoryRecord[]
}>

export type MemoryTrace = Readonly<{
  operation: 'propose' | 'transition' | 'update' | 'expire' | 'merge'
  status: 'committed' | 'rejected' | 'published'
  revision: number
  memoryIds: readonly string[]
  scope: MemoryScope
  reason?: string
}>

export type MemoryCandidateInput = Readonly<{
  id: string
  key: string
  content: string
  scope: MemoryScope
  provenance: MemoryProvenance
  retentionMs?: number
  nowMs?: number
}>

export type MemoryRecallItem = Readonly<{
  record: MemoryRecord
  score: number
  content: string
  truncated: boolean
}>

export type MemoryRecallOptions = Readonly<{
  limit?: number
  maxChars?: number
  nowMs?: number
}>

export type MemoryProjection = Readonly<{
  scope: MemoryScope
  query: string
  items: readonly MemoryRecallItem[]
  text: string
  report: Readonly<{
    selectedCount: number
    omittedCount: number
    chars: number
    bounded: boolean
  }>
}>

export class MemoryInvariantError extends Error {}
export class MemoryRevisionConflictError extends Error {}
export class MemoryTransitionError extends Error {}

export class MemoryStore {
  #revision = 0
  readonly #records = new Map<string, MemoryRecord>()
  readonly #trace: MemoryTrace[] = []
  readonly #clock: () => number

  constructor(clock: () => number = () => Date.now()) {
    this.#clock = clock
  }

  get revision(): number {
    return this.#revision
  }

  snapshot(): MemorySnapshot {
    return deepFreeze({
      revision: this.#revision,
      records: [...this.#records.values()].sort((a, b) => a.id.localeCompare(b.id)),
    })
  }

  traces(): readonly MemoryTrace[] {
    return Object.freeze([...this.#trace])
  }

  propose(expectedRevision: number, input: MemoryCandidateInput): MemorySnapshot {
    this.#requireRevision(expectedRevision, 'propose')
    validateCandidate(input)
    const duplicate = [...this.#records.values()].find(
      record =>
        record.key === input.key &&
        sameScope(record.scope, input.scope) &&
        (record.status === 'candidate' || record.status === 'accepted'),
    )
    if (duplicate) {
      this.#trace.push(trace('merge', 'committed', this.#revision, [duplicate.id], input.scope))
      return this.snapshot()
    }
    if (this.#records.has(input.id)) {
      throw new MemoryInvariantError(`duplicate memory id: ${input.id}`)
    }
    const nowMs = input.nowMs ?? this.#clock()
    const record = deepFreeze({
      id: input.id,
      key: input.key,
      content: input.content,
      scope: deepFreeze({ ...input.scope }),
      provenance: deepFreeze({
        ...input.provenance,
        sourceIds: Object.freeze([...input.provenance.sourceIds]),
      }),
      status: 'candidate' as const,
      createdAt: nowMs,
      updatedAt: nowMs,
      ...(input.retentionMs === undefined ? {} : { retentionMs: input.retentionMs }),
    })
    this.#records.set(record.id, record)
    this.#revision += 1
    this.#trace.push(trace('propose', 'committed', this.#revision, [record.id], record.scope))
    return this.snapshot()
  }

  transition(
    expectedRevision: number,
    id: string,
    status: Exclude<MemoryStatus, 'candidate'>,
    options: Readonly<{ supersededBy?: string; nowMs?: number; retentionMs?: number }> = {},
  ): MemorySnapshot {
    this.#requireRevision(expectedRevision, 'transition')
    const current = this.#requireRecord(id)
    const nowMs = options.nowMs ?? this.#clock()
    if (!validTransition(current.status, status)) {
      throw new MemoryTransitionError(`cannot transition ${current.status} -> ${status}`)
    }
    if (status === 'superseded') {
      if (!options.supersededBy || options.supersededBy === id) {
        throw new MemoryTransitionError('superseded memory requires a different replacement id')
      }
      const replacement = this.#requireRecord(options.supersededBy)
      if (replacement.status !== 'candidate' && replacement.status !== 'accepted') {
        throw new MemoryTransitionError('replacement memory must be candidate or accepted')
      }
    }
    const retentionMs = options.retentionMs ?? current.retentionMs
    if (retentionMs !== undefined && (!Number.isInteger(retentionMs) || retentionMs < 0)) {
      throw new MemoryInvariantError('retentionMs must be a non-negative integer')
    }
    const updated = deepFreeze({
      ...current,
      status,
      updatedAt: nowMs,
      ...(retentionMs === undefined ? {} : { retentionMs }),
      ...(status === 'accepted' && retentionMs !== undefined
        ? { expiresAt: nowMs + retentionMs }
        : {}),
      ...(status !== 'accepted' ? { expiresAt: undefined } : {}),
    })
    this.#records.set(id, updated)
    this.#revision += 1
    this.#trace.push(trace('transition', 'committed', this.#revision, [id], current.scope))
    return this.snapshot()
  }

  updateAccepted(
    expectedRevision: number,
    id: string,
    patch: Readonly<{
      content: string
      provenance: MemoryProvenance
      nowMs?: number
      retentionMs?: number
    }>,
  ): MemorySnapshot {
    this.#requireRevision(expectedRevision, 'update')
    const current = this.#requireRecord(id)
    if (current.status !== 'accepted') {
      throw new MemoryTransitionError('only accepted memories can be updated')
    }
    validateProvenance(patch.provenance)
    requireText(patch.content, 'memory content')
    const nowMs = patch.nowMs ?? this.#clock()
    if (patch.retentionMs !== undefined && (!Number.isInteger(patch.retentionMs) || patch.retentionMs < 0)) {
      throw new MemoryInvariantError('retentionMs must be a non-negative integer')
    }
    const retentionMs = patch.retentionMs ?? current.retentionMs
    const updated = deepFreeze({
      ...current,
      content: patch.content,
      provenance: deepFreeze({ ...patch.provenance, sourceIds: Object.freeze([...patch.provenance.sourceIds]) }),
      updatedAt: nowMs,
      ...(retentionMs === undefined ? {} : { retentionMs, expiresAt: nowMs + retentionMs }),
    })
    this.#records.set(id, updated)
    this.#revision += 1
    this.#trace.push(trace('update', 'committed', this.#revision, [id], current.scope))
    return this.snapshot()
  }

  expire(expectedRevision: number, nowMs = this.#clock()): MemorySnapshot {
    this.#requireRevision(expectedRevision, 'expire')
    const expired: MemoryRecord[] = []
    for (const record of this.#records.values()) {
      if (record.status === 'accepted' && record.expiresAt !== undefined && record.expiresAt <= nowMs) {
        const updated = deepFreeze({ ...record, status: 'expired' as const, updatedAt: nowMs, expiresAt: undefined })
        this.#records.set(record.id, updated)
        expired.push(updated)
      }
    }
    if (expired.length > 0) {
      this.#revision += 1
      this.#trace.push(trace('expire', 'committed', this.#revision, expired.map(item => item.id), expired[0].scope))
    }
    return this.snapshot()
  }

  recall(scope: MemoryScope, query: string, options: MemoryRecallOptions = {}): readonly MemoryRecallItem[] {
    validateScope(scope)
    const limit = options.limit ?? 5
    const maxChars = options.maxChars ?? 4_000
    if (!Number.isInteger(limit) || limit < 0 || !Number.isInteger(maxChars) || maxChars < 0) {
      throw new MemoryInvariantError('recall limits must be non-negative integers')
    }
    const nowMs = options.nowMs ?? this.#clock()
    const terms = tokenize(query)
    const ranked = [...this.#records.values()]
      .filter(record => record.status === 'accepted' && sameScope(record.scope, scope) && (record.expiresAt === undefined || record.expiresAt > nowMs))
      .map(record => ({ record, score: scoreRecord(record, terms) }))
      .sort((a, b) => b.score - a.score || b.record.updatedAt - a.record.updatedAt || a.record.id.localeCompare(b.record.id))
    const output: MemoryRecallItem[] = []
    let remaining = maxChars
    for (const item of ranked) {
      if (output.length >= limit || remaining <= 0) break
      const content = item.record.content.slice(0, remaining)
      if (!content) break
      output.push(Object.freeze({ record: item.record, score: item.score, content, truncated: content.length < item.record.content.length }))
      remaining -= content.length
    }
    return Object.freeze(output)
  }

  #requireRecord(id: string): MemoryRecord {
    requireText(id, 'memory id')
    const record = this.#records.get(id)
    if (!record) throw new MemoryInvariantError(`unknown memory id: ${id}`)
    return record
  }

  #requireRevision(expectedRevision: number, operation: string): void {
    if (!Number.isInteger(expectedRevision) || expectedRevision !== this.#revision) {
      const error = new MemoryRevisionConflictError(`stale memory ${operation}: expected=${expectedRevision}; current=${this.#revision}`)
      const traceOperation: MemoryTrace['operation'] =
        operation === 'propose' ? 'propose' :
        operation === 'update' ? 'update' :
        operation === 'expire' ? 'expire' : 'transition'
      this.#trace.push(trace(traceOperation, 'rejected', this.#revision, [], { kind: 'session', key: 'unknown' }, error.message))
      throw error
    }
  }
}

export class MemoryProjector {
  readonly #store: MemoryStore

  constructor(store: MemoryStore) {
    this.#store = store
  }

  project(scope: MemoryScope, query: string, options: MemoryRecallOptions = {}): MemoryProjection {
    const items = this.#store.recall(scope, query, options)
    const text = items.map(item => `- ${item.record.key}: ${item.content}`).join('\n')
    const bounded = options.maxChars !== undefined || options.limit !== undefined
    return deepFreeze({
      scope,
      query,
      items,
      text,
      report: {
        selectedCount: items.length,
        omittedCount: Math.max(0, this.#store.recall(scope, query).length - items.length),
        chars: text.length,
        bounded,
      },
    })
  }
}

function validTransition(from: MemoryStatus, to: MemoryStatus): boolean {
  return (
    (from === 'candidate' && (to === 'accepted' || to === 'rejected' || to === 'superseded')) ||
    (from === 'accepted' && (to === 'superseded' || to === 'expired'))
  )
}

function scoreRecord(record: MemoryRecord, terms: readonly string[]): number {
  if (terms.length === 0) return 0
  const haystack = `${record.key} ${record.content}`.toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9_\u4e00-\u9fff]+/u).filter(Boolean)
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.key === right.key
}

function trace(
  operation: MemoryTrace['operation'],
  status: MemoryTrace['status'],
  revision: number,
  memoryIds: readonly string[],
  scope: MemoryScope,
  reason?: string,
): MemoryTrace {
  return Object.freeze({ operation, status, revision, memoryIds: Object.freeze([...memoryIds]), scope: Object.freeze({ ...scope }), ...(reason ? { reason } : {}) })
}

function validateCandidate(input: MemoryCandidateInput): void {
  requireText(input.id, 'memory id')
  requireText(input.key, 'memory key')
  requireText(input.content, 'memory content')
  validateScope(input.scope)
  validateProvenance(input.provenance)
  if (input.retentionMs !== undefined && (!Number.isInteger(input.retentionMs) || input.retentionMs < 0)) {
    throw new MemoryInvariantError('retentionMs must be a non-negative integer')
  }
}

function validateScope(scope: MemoryScope): void {
  if (scope.kind !== 'project' && scope.kind !== 'session') throw new MemoryInvariantError('memory scope kind is invalid')
  requireText(scope.key, 'memory scope key')
}

function validateProvenance(provenance: MemoryProvenance): void {
  if (!['user', 'assistant', 'tool', 'system'].includes(provenance.sourceKind)) throw new MemoryInvariantError('memory provenance sourceKind is invalid')
  if (provenance.sourceIds.length === 0 || provenance.sourceIds.some(id => !id.trim())) throw new MemoryInvariantError('memory provenance requires source ids')
  if (!Number.isFinite(provenance.capturedAt)) throw new MemoryInvariantError('memory provenance capturedAt is invalid')
}

function requireText(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new MemoryInvariantError(`${name} must not be empty`)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
