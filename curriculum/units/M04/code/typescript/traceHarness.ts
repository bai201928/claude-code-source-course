export type HarnessMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }

export type TraceEventInput =
  | { type: 'call.entered'; source: string; target: string }
  | { type: 'state.mutated'; owner: string; field: string; size: number }
  | { type: 'view.snapshotted'; owner: string; field: string; size: number }
  | { type: 'event.yielded'; source: string; eventKind: HarnessMessage['kind'] }
  | { type: 'branch.skipped'; branch: string; reason: string }
  | { type: 'call.failed'; source: string; message: string }

export type TraceEvent = TraceEventInput & { seq: number }

export class TraceLog {
  readonly events: TraceEvent[] = []
  #nextSeq = 1

  record(event: TraceEventInput): void {
    this.events.push({ ...event, seq: this.#nextSeq++ } as TraceEvent)
  }

  observedCall(source: string, target: string): boolean {
    return this.events.some(
      event =>
        event.type === 'call.entered' &&
        event.source === source &&
        event.target === target,
    )
  }
}

export type ProcessInputResult = {
  messages: HarnessMessage[]
  shouldQuery: boolean
}

export type ProcessInput = (
  prompt: string,
  history: readonly HarnessMessage[],
) => Promise<ProcessInputResult>

export type QueryStream = (
  messages: readonly HarnessMessage[],
) => AsyncIterable<HarnessMessage>

export class TraceableEngine {
  #messages: HarnessMessage[]
  readonly #processInput: ProcessInput
  readonly #queryStream: QueryStream
  readonly trace: TraceLog

  constructor(
    initialMessages: HarnessMessage[],
    processInput: ProcessInput,
    queryStream: QueryStream,
    trace = new TraceLog(),
  ) {
    this.#messages = initialMessages
    this.#processInput = processInput
    this.#queryStream = queryStream
    this.trace = trace
  }

  getMessages(): readonly HarnessMessage[] {
    return [...this.#messages]
  }

  async *submitMessage(prompt: string): AsyncGenerator<HarnessMessage, void> {
    this.trace.record({
      type: 'call.entered',
      source: 'TraceableEngine.submitMessage',
      target: 'processInput',
    })
    const processed = await this.#processInput(prompt, [...this.#messages])
    this.#messages.push(...processed.messages)
    this.trace.record({
      type: 'state.mutated',
      owner: 'TraceableEngine',
      field: 'messages',
      size: this.#messages.length,
    })

    const requestView = [...this.#messages]
    this.trace.record({
      type: 'view.snapshotted',
      owner: 'TraceableEngine',
      field: 'requestView',
      size: requestView.length,
    })

    if (!processed.shouldQuery) {
      this.trace.record({
        type: 'branch.skipped',
        branch: 'queryStream',
        reason: 'processInput.shouldQuery=false',
      })
      return
    }

    this.trace.record({
      type: 'call.entered',
      source: 'TraceableEngine.submitMessage',
      target: 'queryStream',
    })
    try {
      for await (const message of this.#queryStream(requestView)) {
        this.trace.record({
          type: 'event.yielded',
          source: 'queryStream',
          eventKind: message.kind,
        })
        this.#messages.push(message)
        this.trace.record({
          type: 'state.mutated',
          owner: 'TraceableEngine',
          field: 'messages',
          size: this.#messages.length,
        })
        yield message
      }
    } catch (error) {
      this.trace.record({
        type: 'call.failed',
        source: 'queryStream',
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
}

export type ToolProbe = {
  name: string
  run(): void
}

export async function passToolToPermission(
  tool: ToolProbe,
  canUseTool: (candidate: ToolProbe) => Promise<boolean>,
  trace: TraceLog,
): Promise<boolean> {
  trace.record({
    type: 'call.entered',
    source: 'permissionWrapper',
    target: 'canUseTool',
  })
  return canUseTool(tool)
}

export async function collect(
  stream: AsyncIterable<HarnessMessage>,
): Promise<HarnessMessage[]> {
  const messages: HarnessMessage[] = []
  for await (const message of stream) messages.push(message)
  return messages
}
