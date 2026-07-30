import type { AgentRunStream } from './stream.ts'
import type { ModelStreamEvent } from './streamEvents.ts'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject
export type JsonObject = { [key: string]: JsonValue }

export type ModelToolDefinition = Readonly<{
  name: string
  description: string
  inputSchema: Readonly<Record<string, unknown>>
}>

export type ModelToolCall = Readonly<{
  id: string
  name: string
  input: Readonly<Record<string, unknown>>
}>

export type ModelMessage =
  | Readonly<{ role: 'system' | 'user'; content: string }>
  | Readonly<{
      role: 'assistant'
      content: string | null
      toolCalls?: readonly ModelToolCall[]
    }>
  | Readonly<{ role: 'tool'; toolCallId: string; content: string }>

export type ModelRequest = Readonly<{
  requestId: string
  model: string
  messages: readonly ModelMessage[]
  tools: readonly ModelToolDefinition[]
}>

export type ModelUsage = Readonly<{
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}>

export type ModelResponse = Readonly<{
  responseId: string
  text?: string
  toolCalls: readonly ModelToolCall[]
  usage?: ModelUsage
}>

export interface ModelAdapter {
  readonly provider: string
  readonly model: string
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>
  /** Optional M14 pull path. Existing complete-only adapters remain valid. */
  stream?(request: ModelRequest, signal: AbortSignal): Promise<AgentRunStream<ModelStreamEvent>>
}

export class ModelProtocolError extends Error {}
export class ModelTransportError extends Error {
  readonly category: 'authentication' | 'rate-limit' | 'provider' | 'network'
  readonly status?: number

  constructor(
    message: string,
    category: ModelTransportError['category'],
    status?: number,
  ) {
    super(message)
    this.name = 'ModelTransportError'
    this.category = category
    this.status = status
  }
}
