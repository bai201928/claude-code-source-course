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

export class RequestProjector {
  readonly #store: ConversationStore

  constructor(store: ConversationStore) {
    this.#store = store
  }

  project(input: ProjectionInput): ModelRequest {
    this.#store.assertRequestReady(input.conversation)
    const visibleNames = new Set(input.capabilities.schemas.map(schema => schema.name))
    for (const tool of input.tools) {
      if (!visibleNames.has(tool.name)) {
        throw new Error(`request contains a tool outside its capability snapshot: ${tool.name}`)
      }
    }
    return deepFreeze({
      requestId: input.requestContext.requestId,
      model: input.model,
      messages: input.conversation.messages.map(projectMessage),
      tools: input.tools.map(tool => structuredClone(tool)),
    })
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
