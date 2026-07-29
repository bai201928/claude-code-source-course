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
  toolResultPreviewChars?: number
}>

export type RequestProjectionReport = Readonly<{
  sourceCount: number
  selectedCount: number
  projectedCount: number
  omittedBeforeHistoryStart: number
  replacedToolResultCount: number
  userContextInjected: boolean
  strictValidation: 'passed'
}>

export type RequestProjectionResult = Readonly<{
  request: ModelRequest
  report: RequestProjectionReport
}>

export class RequestProjectionError extends Error {}

export class RequestProjector {
  readonly #store: ConversationStore

  constructor(store: ConversationStore) {
    this.#store = store
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
    const previewChars = policy.toolResultPreviewChars ?? 96
    if (
      (maxToolResultChars !== Number.POSITIVE_INFINITY &&
        (!Number.isInteger(maxToolResultChars) || maxToolResultChars < 1)) ||
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
    const projected = selected.map(message => {
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
    const userContext = policy.userContext?.trim()
    const messages = userContext
      ? insertUserContext(projected, `<system-reminder>\n${userContext}\n</system-reminder>`)
      : projected
    assertStrictPairing(messages)
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
        replacedToolResultCount,
        userContextInjected: Boolean(userContext),
        strictValidation: 'passed' as const,
      },
    })
  }
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
