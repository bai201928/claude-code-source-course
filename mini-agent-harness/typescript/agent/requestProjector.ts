import type { CapabilitySnapshot } from '../capabilityProjection.ts'
import {
  ConversationStore,
  type AssistantMessage,
  type ConversationSnapshot,
  type DurableMessage,
} from '../conversationStore.ts'
import type { RequestContext } from '../runtimeContext.ts'
import type {
  ModelMessage,
  ModelRequest,
  ModelToolCall,
  ModelToolDefinition,
} from './model.ts'

export type ProjectionInput = Readonly<{
  requestContext: RequestContext
  conversation: ConversationSnapshot
  capabilities: CapabilitySnapshot
  tools: readonly ModelToolDefinition[]
  model: string
}>

export type RequestProjectionPolicy = Readonly<{
  historyStart?: number
  userContext?: string
  maxToolResultChars?: number
  maxToolResultGroupChars?: number
  toolResultPreviewChars?: number
}>

export type RequestProjectionReport = Readonly<{
  sourceCount: number
  selectedCount: number
  projectedCount: number
  omittedBeforeHistoryStart: number
  replacedToolResultCount: number
  newlyReplacedToolResultCount: number
  reappliedToolResultCount: number
  frozenToolResultCount: number
  aggregateBudgetGroupCount: number
  overBudgetToolResultGroupCount: number
  replacementRevision: number
  userContextInjected: boolean
  strictValidation: 'passed'
}>

export type RequestProjectionResult = Readonly<{
  request: ModelRequest
  report: RequestProjectionReport
}>

export class RequestProjectionError extends Error {}
export class StaleReplacementRevisionError extends Error {}

export type ResultBudgetLedgerSnapshot = Readonly<{
  revision: number
  seenIds: ReadonlySet<string>
  replacements: ReadonlyMap<string, string>
}>

export type ResultBudgetLedgerChange = Readonly<{
  expectedRevision: number
  seenIds: ReadonlySet<string>
  replacements: ReadonlyMap<string, string>
}>

export class ResultBudgetLedger {
  #revision = 0
  readonly #seenIds = new Set<string>()
  readonly #replacements = new Map<string, string>()

  snapshot(): ResultBudgetLedgerSnapshot {
    return Object.freeze({
      revision: this.#revision,
      seenIds: new Set(this.#seenIds),
      replacements: new Map(this.#replacements),
    })
  }

  commit(change: ResultBudgetLedgerChange): number {
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

export class RequestProjector {
  readonly #store: ConversationStore
  readonly #resultBudgetLedger: ResultBudgetLedger

  constructor(
    store: ConversationStore,
    resultBudgetLedger: ResultBudgetLedger = new ResultBudgetLedger(),
  ) {
    this.#store = store
    this.#resultBudgetLedger = resultBudgetLedger
  }

  project(input: ProjectionInput, policy: RequestProjectionPolicy = {}): ModelRequest {
    return this.projectWithReport(input, policy).request
  }

  projectWithReport(
    input: ProjectionInput,
    policy: RequestProjectionPolicy = {},
  ): RequestProjectionResult {
    this.#store.assertRequestReady(input.conversation)
    const historyStart = policy.historyStart ?? 0
    if (!Number.isInteger(historyStart) || historyStart < 0 || historyStart > input.conversation.messages.length) {
      throw new RequestProjectionError('historyStart must be a valid durable message index')
    }
    const maxToolResultChars = policy.maxToolResultChars ?? Number.POSITIVE_INFINITY
    const maxToolResultGroupChars =
      policy.maxToolResultGroupChars ?? Number.POSITIVE_INFINITY
    const previewChars = policy.toolResultPreviewChars ?? 96
    if (
      (maxToolResultChars !== Number.POSITIVE_INFINITY &&
        (!Number.isInteger(maxToolResultChars) || maxToolResultChars < 1)) ||
      (maxToolResultGroupChars !== Number.POSITIVE_INFINITY &&
        (!Number.isInteger(maxToolResultGroupChars) ||
          maxToolResultGroupChars < 1)) ||
      !Number.isInteger(previewChars) || previewChars < 0
    ) {
      throw new RequestProjectionError('tool-result preview limits must be non-negative integers')
    }
    const visibleNames = new Set(input.capabilities.schemas.map(schema => schema.name))
    for (const tool of input.tools) {
      if (!visibleNames.has(tool.name)) {
        throw new Error(`request contains a tool outside its capability snapshot: ${tool.name}`)
      }
    }
    const selected = input.conversation.messages.slice(historyStart)
    let replacedToolResultCount = 0
    const perResultProjected = selected.map(message => {
      const modelMessage = projectMessage(message)
      if (
        modelMessage.role !== 'tool' ||
        modelMessage.content.length <= maxToolResultChars
      ) return modelMessage
      replacedToolResultCount += 1
      const prefix = modelMessage.content.slice(0, previewChars)
      return Object.freeze({
        ...modelMessage,
        content: `[tool result ${modelMessage.toolCallId} preview: ${modelMessage.content.length} chars; prefix=${JSON.stringify(prefix)}]`,
      })
    })
    const ledgerSnapshot = this.#resultBudgetLedger.snapshot()
    const aggregate = maxToolResultGroupChars === Number.POSITIVE_INFINITY
      ? emptyAggregateProjection(perResultProjected, ledgerSnapshot.revision)
      : applyAggregateResultBudget(
          perResultProjected,
          ledgerSnapshot,
          maxToolResultGroupChars,
          previewChars,
        )
    const userContext = policy.userContext?.trim()
    const messages = userContext
      ? insertUserContext(aggregate.messages, `<system-reminder>\n${userContext}\n</system-reminder>`)
      : aggregate.messages
    assertStrictPairing(messages)
    const replacementRevision = this.#resultBudgetLedger.commit(aggregate.change)
    const request = deepFreeze({
      requestId: input.requestContext.requestId,
      model: input.model,
      messages,
      tools: input.tools.map(tool => structuredClone(tool)),
    })
    return deepFreeze({
      request,
      report: {
        sourceCount: input.conversation.messages.length,
        selectedCount: selected.length,
        projectedCount: messages.length,
        omittedBeforeHistoryStart: historyStart,
        replacedToolResultCount:
          replacedToolResultCount +
          aggregate.newlyReplacedCount +
          aggregate.reappliedCount,
        newlyReplacedToolResultCount: aggregate.newlyReplacedCount,
        reappliedToolResultCount: aggregate.reappliedCount,
        frozenToolResultCount: aggregate.frozenCount,
        aggregateBudgetGroupCount: aggregate.groupCount,
        overBudgetToolResultGroupCount: aggregate.overBudgetGroupCount,
        replacementRevision,
        userContextInjected: Boolean(userContext),
        strictValidation: 'passed' as const,
      },
    })
  }
}

type AggregateProjection = Readonly<{
  messages: readonly ModelMessage[]
  newlyReplacedCount: number
  reappliedCount: number
  frozenCount: number
  groupCount: number
  overBudgetGroupCount: number
  change: ResultBudgetLedgerChange
}>

function emptyAggregateProjection(
  messages: readonly ModelMessage[],
  revision: number,
): AggregateProjection {
  return {
    messages,
    newlyReplacedCount: 0,
    reappliedCount: 0,
    frozenCount: 0,
    groupCount: 0,
    overBudgetGroupCount: 0,
    change: {
      expectedRevision: revision,
      seenIds: new Set(),
      replacements: new Map(),
    },
  }
}

function applyAggregateResultBudget(
  messages: readonly ModelMessage[],
  ledger: ResultBudgetLedgerSnapshot,
  limit: number,
  previewChars: number,
): AggregateProjection {
  const projected = [...messages]
  const groups: number[][] = []
  let current: number[] = []
  const flush = () => {
    if (current.length > 0) groups.push(current)
    current = []
  }
  messages.forEach((message, index) => {
    if (message.role === 'tool') current.push(index)
    else flush()
  })
  flush()

  const seenDelta = new Set<string>()
  const replacementDelta = new Map<string, string>()
  let newlyReplacedCount = 0
  let reappliedCount = 0
  let frozenCount = 0
  let overBudgetGroupCount = 0

  for (const group of groups) {
    const fresh: Array<{
      index: number
      callId: string
      content: string
    }> = []
    for (const index of group) {
      const message = projected[index]
      if (!message || message.role !== 'tool') continue
      const prior = ledger.replacements.get(message.toolCallId)
      if (prior !== undefined) {
        projected[index] = Object.freeze({ ...message, content: prior })
        reappliedCount += 1
      } else if (ledger.seenIds.has(message.toolCallId)) {
        frozenCount += 1
      } else {
        fresh.push({ index, callId: message.toolCallId, content: message.content })
      }
    }

    let projectedChars = group.reduce((total, index) => {
      const message = projected[index]
      return total + (message?.role === 'tool' ? message.content.length : 0)
    }, 0)
    const remaining = [...fresh]
    while (projectedChars > limit && remaining.length > 0) {
      const ranked = remaining
        .map(candidate => {
          const replacement = toolResultPreview(
            candidate.callId,
            candidate.content,
            previewChars,
          )
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
      remaining.splice(
        remaining.findIndex(item => item.callId === choice.candidate.callId),
        1,
      )
      projected[choice.candidate.index] = Object.freeze({
        role: 'tool' as const,
        toolCallId: choice.candidate.callId,
        content: choice.replacement,
      })
      projectedChars -= choice.reduction
      replacementDelta.set(choice.candidate.callId, choice.replacement)
      newlyReplacedCount += 1
    }
    for (const candidate of fresh) seenDelta.add(candidate.callId)
    if (projectedChars > limit) overBudgetGroupCount += 1
  }

  return {
    messages: projected,
    newlyReplacedCount,
    reappliedCount,
    frozenCount,
    groupCount: groups.length,
    overBudgetGroupCount,
    change: {
      expectedRevision: ledger.revision,
      seenIds: seenDelta,
      replacements: replacementDelta,
    },
  }
}

function toolResultPreview(
  toolCallId: string,
  content: string,
  previewChars: number,
): string {
  const prefix = content.slice(0, previewChars)
  return `[tool result ${toolCallId} preview: ${content.length} chars; prefix=${JSON.stringify(prefix)}]`
}

function insertUserContext(messages: readonly ModelMessage[], content: string): ModelMessage[] {
  const firstNonSystem = messages.findIndex(message => message.role !== 'system')
  const insertionIndex = firstNonSystem < 0 ? messages.length : firstNonSystem
  return [
    ...messages.slice(0, insertionIndex),
    Object.freeze({ role: 'user' as const, content }),
    ...messages.slice(insertionIndex),
  ]
}

function assertStrictPairing(messages: readonly ModelMessage[]): void {
  const pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!pending.delete(message.toolCallId)) {
        throw new RequestProjectionError(`orphan or duplicate tool result: ${message.toolCallId}`)
      }
      continue
    }
    if (pending.size > 0) {
      throw new RequestProjectionError(`missing tool results: ${[...pending].join(',')}`)
    }
    if (message.role !== 'assistant') continue
    for (const call of message.toolCalls ?? []) {
      if (pending.has(call.id)) {
        throw new RequestProjectionError(`duplicate tool use id: ${call.id}`)
      }
      pending.add(call.id)
    }
  }
  if (pending.size > 0) {
    throw new RequestProjectionError(`missing tool results: ${[...pending].join(',')}`)
  }
}

function projectMessage(message: DurableMessage): ModelMessage {
  switch (message.kind) {
    case 'system':
      return Object.freeze({ role: 'system', content: message.text })
    case 'human':
      return Object.freeze({ role: 'user', content: message.text })
    case 'tool-result':
      return Object.freeze({
        role: 'tool',
        toolCallId: message.toolUseId,
        content: message.output,
      })
    case 'assistant':
      return projectAssistant(message)
    default:
      return assertNever(message)
  }
}

function projectAssistant(message: AssistantMessage): ModelMessage {
  const text = message.blocks
    .filter(block => block.kind === 'text')
    .map(block => block.text)
    .join('\n')
  const toolCalls: ModelToolCall[] = message.blocks
    .filter(block => block.kind === 'tool-use')
    .map(block => Object.freeze({
      id: block.id,
      name: block.name,
      input: structuredClone(block.input),
    }))
  return Object.freeze({
    role: 'assistant',
    content: text || null,
    ...(toolCalls.length ? { toolCalls: Object.freeze(toolCalls) } : {}),
  })
}

function assertNever(value: never): never {
  throw new Error(`unknown durable message: ${JSON.stringify(value)}`)
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.isFrozen(value) ? value : Object.freeze(value)
}
