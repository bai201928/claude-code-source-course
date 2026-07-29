export type TraceScalar = string | number | boolean | null
export type TraceAttributes = Readonly<Record<string, TraceScalar>>

export type AgentTraceEvent = Readonly<{
  sequence: number
  timestamp: string
  runId: string
  type: string
  attributes: TraceAttributes
}>

export interface TraceSink {
  write(event: AgentTraceEvent): void | Promise<void>
  flush?(): void | Promise<void>
}

export class MemoryTraceSink implements TraceSink {
  readonly events: AgentTraceEvent[] = []

  write(event: AgentTraceEvent): void {
    this.events.push(event)
  }
}

export class JsonLineTraceSink implements TraceSink {
  readonly #writeLine: (line: string) => void

  constructor(writeLine: (line: string) => void = line => process.stderr.write(line)) {
    this.#writeLine = writeLine
  }

  write(event: AgentTraceEvent): void {
    this.#writeLine(`${JSON.stringify(event)}\n`)
  }
}

export class TraceRecorder {
  #sequence = 0
  readonly #errors: string[] = []
  readonly #sinks: readonly TraceSink[]
  readonly #now: () => Date

  constructor(
    sinks: readonly TraceSink[],
    now: () => Date = () => new Date(),
  ) {
    this.#sinks = [...sinks]
    this.#now = now
  }

  async record(
    runId: string,
    type: string,
    attributes: TraceAttributes = {},
  ): Promise<void> {
    const forbidden = Object.keys(attributes).filter(key =>
      CONTENT_ATTRIBUTE_NAMES.has(key.toLowerCase()),
    )
    if (forbidden.length > 0) {
      this.#errors.push(`rejected content-bearing trace attributes: ${forbidden.join(',')}`)
      return
    }
    const event = Object.freeze({
      sequence: ++this.#sequence,
      timestamp: this.#now().toISOString(),
      runId,
      type,
      attributes: Object.freeze({ ...attributes }),
    })
    for (const sink of this.#sinks) {
      try {
        await sink.write(event)
      } catch (error) {
        this.#errors.push(`trace sink write failed: ${errorMessage(error)}`)
      }
    }
  }

  async flush(): Promise<void> {
    for (const sink of this.#sinks) {
      try {
        await sink.flush?.()
      } catch (error) {
        this.#errors.push(`trace sink flush failed: ${errorMessage(error)}`)
      }
    }
  }

  errors(): readonly string[] {
    return Object.freeze([...this.#errors])
  }
}

const CONTENT_ATTRIBUTE_NAMES = new Set([
  'prompt',
  'input',
  'output',
  'content',
  'text',
  'messages',
  'toolinput',
  'tool_input',
])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
