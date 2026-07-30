export type UsageSnapshot = Readonly<{
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadInputTokens?: number | null
}>

export type RawStreamEvent =
  | Readonly<{ type: 'message_start'; message: Readonly<{ id: string; usage: UsageSnapshot }> }>
  | Readonly<{
      type: 'content_block_start'
      index: number
      contentBlock:
        | Readonly<{ type: 'text'; text?: string }>
        | Readonly<{ type: 'thinking'; thinking?: string; signature?: string }>
        | Readonly<{ type: 'tool_use'; id: string; name: string; input?: unknown }>
    }>
  | Readonly<{
      type: 'content_block_delta'
      index: number
      delta:
        | Readonly<{ type: 'text_delta'; text: string }>
        | Readonly<{ type: 'thinking_delta'; thinking: string }>
        | Readonly<{ type: 'signature_delta'; signature: string }>
        | Readonly<{ type: 'input_json_delta'; partialJson: string }>
    }>
  | Readonly<{ type: 'content_block_stop'; index: number }>
  | Readonly<{
      type: 'message_delta'
      usage: UsageSnapshot
      stopReason: string | null
    }>
  | Readonly<{ type: 'message_stop' }>

export type TextBlock = Readonly<{ type: 'text'; text: string }>
export type ThinkingBlock = Readonly<{ type: 'thinking'; thinking: string; signature: string }>
export type ToolUseBlock = Readonly<{
  type: 'tool_use'
  id: string
  name: string
  input: Readonly<Record<string, unknown>>
}>
export type AssistantBlock = TextBlock | ThinkingBlock | ToolUseBlock

export type AssistantMessage = {
  readonly type: 'assistant'
  readonly responseId: string
  readonly content: readonly AssistantBlock[]
  usage: Usage
  stopReason: string | null
}

export type Usage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
}

export type AssemblerOutput =
  | Readonly<{ type: 'assistant'; message: AssistantMessage }>
  | Readonly<{ type: 'stream_event'; event: RawStreamEvent }>

export class StreamProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StreamProtocolError'
  }
}

type MutableBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: string }

export class UsageRecord {
  #snapshot: Usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 }
  #total: Usage = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 }
  #responses = 0
  #ttftMs: number | undefined

  applyCumulative(snapshot: UsageSnapshot): Usage {
    if (snapshot.inputTokens != null && snapshot.inputTokens > 0) {
      this.#snapshot.inputTokens = snapshot.inputTokens
    }
    if (snapshot.cacheReadInputTokens != null && snapshot.cacheReadInputTokens > 0) {
      this.#snapshot.cacheReadInputTokens = snapshot.cacheReadInputTokens
    }
    if (snapshot.outputTokens != null) this.#snapshot.outputTokens = snapshot.outputTokens
    return this.snapshot()
  }

  recordResponse(snapshot: Usage): void {
    this.#responses += 1
    this.#total.inputTokens += snapshot.inputTokens
    this.#total.outputTokens += snapshot.outputTokens
    this.#total.cacheReadInputTokens += snapshot.cacheReadInputTokens
  }

  setTTFT(ttftMs: number | undefined): void {
    this.#ttftMs = ttftMs
  }

  snapshot(): Usage {
    return { ...this.#snapshot }
  }

  report(): Readonly<{
    usage: Usage
    responseCount: number
    ttftMs?: number
  }> {
    return Object.freeze({
      usage: { ...this.#total },
      responseCount: this.#responses,
      ...(this.#ttftMs === undefined ? {} : { ttftMs: this.#ttftMs }),
    })
  }
}

export class StreamingAssembler {
  readonly #startedAt: number
  readonly #now: () => number
  readonly #blocks = new Map<number, MutableBlock>()
  readonly #messages: AssistantMessage[] = []
  readonly #usage = new UsageRecord()
  #started = false
  #stopReason: string | null = null
  #responseId = 'response-unknown'

  constructor(options?: { startedAt?: number; now?: () => number }) {
    this.#startedAt = options?.startedAt ?? 0
    this.#now = options?.now ?? (() => Date.now())
  }

  consume(event: RawStreamEvent): AssemblerOutput[] {
    const output: AssemblerOutput[] = []
    switch (event.type) {
      case 'message_start':
        if (this.#started) throw new StreamProtocolError('duplicate message_start')
        this.#started = true
        this.#responseId = event.message.id
        this.#usage.applyCumulative(event.message.usage)
        this.#usage.setTTFT(Math.max(0, this.#now() - this.#startedAt))
        break
      case 'content_block_start':
        this.#requireStarted()
        if (this.#blocks.has(event.index)) {
          throw new StreamProtocolError(`duplicate content block ${event.index}`)
        }
        this.#blocks.set(event.index, this.#newBlock(event.contentBlock))
        break
      case 'content_block_delta':
        this.#requireStarted()
        this.#applyDelta(event.index, event.delta)
        break
      case 'content_block_stop': {
        this.#requireStarted()
        const block = this.#blocks.get(event.index)
        if (!block) throw new StreamProtocolError(`content block ${event.index} not found`)
        const message: AssistantMessage = {
          type: 'assistant',
          responseId: this.#responseId,
          content: [this.#finishBlock(block)],
          usage: this.#usage.snapshot(),
          stopReason: this.#stopReason,
        }
        this.#messages.push(message)
        output.push(Object.freeze({ type: 'assistant', message }))
        break
      }
      case 'message_delta':
        this.#requireStarted()
        this.#usage.applyCumulative(event.usage)
        this.#stopReason = event.stopReason
        const last = this.#messages.at(-1)
        if (last) {
          // Keep the object reference: a lazy transcript writer may already own it.
          last.usage = this.#usage.snapshot()
          last.stopReason = this.#stopReason
        }
        break
      case 'message_stop':
        this.#requireStarted()
        break
    }
    output.push(Object.freeze({ type: 'stream_event', event }))
    return output
  }

  finish(): Readonly<{ messages: readonly AssistantMessage[]; usage: Usage; stopReason: string | null }> {
    this.#requireStarted()
    if (this.#messages.length === 0 && !this.#stopReason) {
      throw new StreamProtocolError('stream ended without a completed message')
    }
    return Object.freeze({
      messages: this.#messages,
      usage: this.#usage.snapshot(),
      stopReason: this.#stopReason,
    })
  }

  usageReport(): ReturnType<UsageRecord['report']> {
    return this.#usage.report()
  }

  #requireStarted(): void {
    if (!this.#started) throw new StreamProtocolError('message_start is required first')
  }

  #newBlock(block: Extract<RawStreamEvent, { type: 'content_block_start' }>['contentBlock']): MutableBlock {
    switch (block.type) {
      case 'text': return { type: 'text', text: '' }
      case 'thinking': return { type: 'thinking', thinking: '', signature: '' }
      case 'tool_use': return { type: 'tool_use', id: block.id, name: block.name, input: '' }
    }
  }

  #applyDelta(index: number, delta: Extract<RawStreamEvent, { type: 'content_block_delta' }>['delta']): void {
    const block = this.#blocks.get(index)
    if (!block) throw new StreamProtocolError(`content block ${index} not found`)
    switch (delta.type) {
      case 'text_delta':
        if (block.type !== 'text') throw new StreamProtocolError('text delta on non-text block')
        block.text += delta.text
        break
      case 'thinking_delta':
        if (block.type !== 'thinking') throw new StreamProtocolError('thinking delta on non-thinking block')
        block.thinking += delta.thinking
        break
      case 'signature_delta':
        if (block.type !== 'thinking') throw new StreamProtocolError('signature delta on non-thinking block')
        block.signature = delta.signature
        break
      case 'input_json_delta':
        if (block.type !== 'tool_use') throw new StreamProtocolError('input JSON delta on non-tool block')
        block.input += delta.partialJson
        break
    }
  }

  #finishBlock(block: MutableBlock): AssistantBlock {
    switch (block.type) {
      case 'text': return Object.freeze({ type: 'text', text: block.text })
      case 'thinking': return Object.freeze({ type: 'thinking', thinking: block.thinking, signature: block.signature })
      case 'tool_use': {
        let input: unknown
        try { input = JSON.parse(block.input || '{}') } catch { throw new StreamProtocolError('invalid tool input JSON') }
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw new StreamProtocolError('tool input must be an object')
        }
        return Object.freeze({ type: 'tool_use', id: block.id, name: block.name, input: Object.freeze(input as Record<string, unknown>) })
      }
    }
  }
}
