import {
  ModelProtocolError,
  ModelTransportError,
  type ModelAdapter,
  type ModelMessage,
  type ModelRequest,
  type ModelResponse,
  type ModelToolCall,
} from './model.ts'

export type HttpRequest = Readonly<{
  url: string
  headers: Readonly<Record<string, string>>
  body: string
}>

export type HttpResponse = Readonly<{
  status: number
  body: unknown
}>

export interface HttpTransport {
  send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse>
}

export class FetchTransport implements HttpTransport {
  async send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
    let response: Response
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal,
      })
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error
      throw new ModelTransportError('model request failed at the network boundary', 'network')
    }
    if (response.status < 200 || response.status >= 300) {
      return Object.freeze({ status: response.status, body: undefined })
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ModelProtocolError('model provider returned a non-JSON response')
    }
    return Object.freeze({ status: response.status, body })
  }
}

export type OpenAICompatibleOptions = Readonly<{
  apiKey: string
  baseUrl?: string
  model: string
  transport?: HttpTransport
  allowInsecureLocalhost?: boolean
}>

export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly provider = 'openai-compatible'
  readonly model: string
  readonly #apiKey: string
  readonly #endpoint: string
  readonly #transport: HttpTransport

  constructor(options: OpenAICompatibleOptions) {
    if (!options.apiKey.trim()) throw new Error('MINI_AGENT_API_KEY is required')
    if (!options.model.trim()) throw new Error('model must not be empty')
    this.#apiKey = options.apiKey
    this.model = options.model
    this.#endpoint = chatCompletionsUrl(
      options.baseUrl ?? 'https://api.deepseek.com/v1',
      options.allowInsecureLocalhost ?? false,
    )
    this.#transport = options.transport ?? new FetchTransport()
  }

  async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (request.model !== this.model) {
      throw new ModelProtocolError(
        `request model ${request.model} does not match adapter model ${this.model}`,
      )
    }
    const payload = {
      model: request.model,
      messages: request.messages.map(projectMessage),
      ...(request.tools.length
        ? {
            tools: request.tools.map(tool => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
            tool_choice: 'auto',
          }
        : {}),
      stream: false,
    }
    const response = await this.#transport.send(
      Object.freeze({
        url: this.#endpoint,
        headers: Object.freeze({
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
        }),
        body: JSON.stringify(payload),
      }),
      signal,
    )
    if (response.status < 200 || response.status >= 300) {
      throw transportStatusError(response.status)
    }
    return parseResponse(response.body)
  }
}

function projectMessage(message: ModelMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map(call => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.input) },
            })),
          }
        : {}),
    }
  }
  return { role: message.role, content: message.content }
}

function parseResponse(value: unknown): ModelResponse {
  const root = requireRecord(value, 'provider response')
  const responseId = requireString(root.id, 'provider response id')
  if (!Array.isArray(root.choices) || root.choices.length === 0) {
    throw new ModelProtocolError('provider response must contain at least one choice')
  }
  const choice = requireRecord(root.choices[0], 'provider choice')
  const finishReason = requireString(choice.finish_reason, 'provider finish_reason')
  if (finishReason !== 'stop' && finishReason !== 'tool_calls') {
    throw new ModelProtocolError(
      `provider terminated the response with unsupported finish_reason: ${finishReason}`,
    )
  }
  const message = requireRecord(choice.message, 'provider assistant message')
  if (message.role !== 'assistant') {
    throw new ModelProtocolError('provider choice message role must be assistant')
  }
  const text = message.content === null || message.content === undefined
    ? undefined
    : requireString(message.content, 'assistant content', true)
  const toolCalls = parseToolCalls(message.tool_calls)
  if (finishReason === 'tool_calls' && toolCalls.length === 0) {
    throw new ModelProtocolError('provider reported tool_calls without a function call')
  }
  if (finishReason === 'stop' && toolCalls.length > 0) {
    throw new ModelProtocolError('provider returned function calls with finish_reason stop')
  }
  if (!text && toolCalls.length === 0) {
    throw new ModelProtocolError('provider assistant message has neither text nor tool calls')
  }
  const usage = parseUsage(root.usage)
  return Object.freeze({
    responseId,
    ...(text ? { text } : {}),
    toolCalls: Object.freeze(toolCalls),
    ...(usage ? { usage } : {}),
  })
}

function parseToolCalls(value: unknown): ModelToolCall[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new ModelProtocolError('tool_calls must be an array')
  return value.map((entry, index) => {
    const call = requireRecord(entry, `tool call ${index}`)
    if (call.type !== 'function') {
      throw new ModelProtocolError(`tool call ${index} type must be function`)
    }
    const fn = requireRecord(call.function, `tool call ${index} function`)
    const rawArguments = requireString(fn.arguments, `tool call ${index} arguments`, true)
    let parsed: unknown
    try {
      parsed = JSON.parse(rawArguments || '{}')
    } catch {
      throw new ModelProtocolError(`tool call ${index} arguments are not valid JSON`)
    }
    const input = requireRecord(parsed, `tool call ${index} arguments`)
    return Object.freeze({
      id: requireString(call.id, `tool call ${index} id`),
      name: requireString(fn.name, `tool call ${index} name`),
      input: Object.freeze(structuredClone(input)),
    })
  })
}

function parseUsage(value: unknown): ModelResponse['usage'] | undefined {
  if (value === undefined || value === null) return undefined
  const usage = requireRecord(value, 'usage')
  const inputTokens = optionalNumber(usage.prompt_tokens, 'usage.prompt_tokens')
  const outputTokens = optionalNumber(usage.completion_tokens, 'usage.completion_tokens')
  const totalTokens = optionalNumber(usage.total_tokens, 'usage.total_tokens')
  return Object.freeze({
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  })
}

function chatCompletionsUrl(baseUrl: string, allowInsecureLocalhost: boolean): string {
  const url = new URL(baseUrl)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
  if (url.protocol !== 'https:' && !(allowInsecureLocalhost && local && url.protocol === 'http:')) {
    throw new Error('base URL must use HTTPS; HTTP is allowed only for explicit localhost tests')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('base URL must not contain credentials, query parameters, or fragments')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return new URL('chat/completions', url).toString()
}

function transportStatusError(status: number): ModelTransportError {
  if (status === 401 || status === 403) {
    return new ModelTransportError('model provider rejected authentication', 'authentication', status)
  }
  if (status === 429) {
    return new ModelTransportError('model provider rate limit exceeded', 'rate-limit', status)
  }
  return new ModelTransportError(`model provider returned HTTP ${status}`, 'provider', status)
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ModelProtocolError(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new ModelProtocolError(`${name} must be a string`)
  }
  return value
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ModelProtocolError(`${name} must be a non-negative number`)
  }
  return value
}
