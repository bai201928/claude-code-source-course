import { H0Harness } from './h0.ts'

export type RuntimeCommand = {
  type: 'prompt'
  text: string
}

export type DomainEvent =
  | { type: 'progress'; text: string }
  | { type: 'result'; text: string }
  | { type: 'failure'; message: string }

export interface RuntimeCore {
  run(command: RuntimeCommand): AsyncIterable<DomainEvent>
}

export type H0HarnessFactory = () => H0Harness

export class H0RuntimeCore implements RuntimeCore {
  readonly #createHarness: H0HarnessFactory

  constructor(createHarness: H0HarnessFactory) {
    this.#createHarness = createHarness
  }

  async *run(command: RuntimeCommand): AsyncGenerator<DomainEvent> {
    const harness = this.#createHarness()
    try {
      for await (const message of harness.run(command.text)) {
        switch (message.kind) {
          case 'progress':
            yield { type: 'progress', text: message.text }
            break
          case 'assistant':
            yield { type: 'result', text: message.text }
            break
          case 'user':
            break
          default:
            assertNever(message)
        }
      }
    } catch (error) {
      yield {
        type: 'failure',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export type SurfaceTraceInput =
  | { type: 'surface.opened'; surface: 'interactive' | 'headless' }
  | { type: 'input.accepted'; surface: 'interactive' | 'headless' }
  | { type: 'input.rejected'; surface: 'interactive' | 'headless'; reason: string }
  | { type: 'core.called'; surface: 'interactive' | 'headless' }
  | { type: 'event.received'; surface: 'interactive' | 'headless'; event: DomainEvent['type'] }
  | { type: 'output.projected'; surface: 'interactive' | 'headless'; format: string }
  | { type: 'surface.closed'; surface: 'interactive' | 'headless' }

export type SurfaceTraceEvent = SurfaceTraceInput & { seq: number }

export class SurfaceTrace {
  readonly events: SurfaceTraceEvent[] = []
  #nextSeq = 1

  record(event: SurfaceTraceInput): void {
    this.events.push({ ...event, seq: this.#nextSeq++ } as SurfaceTraceEvent)
  }
}

export type SurfaceRun = {
  events: DomainEvent[]
  output: string[]
}

abstract class BaseSurface {
  #opened = false
  #closed = false
  protected readonly surface: 'interactive' | 'headless'
  protected readonly core: RuntimeCore
  readonly trace: SurfaceTrace

  protected constructor(
    surface: 'interactive' | 'headless',
    core: RuntimeCore,
    trace: SurfaceTrace = new SurfaceTrace(),
  ) {
    this.surface = surface
    this.core = core
    this.trace = trace
  }

  protected ensureOpen(): void {
    if (this.#closed) throw new Error(`${this.surface} surface is closed`)
    if (!this.#opened) {
      this.#opened = true
      this.trace.record({ type: 'surface.opened', surface: this.surface })
    }
  }

  protected async callCore(command: RuntimeCommand): Promise<DomainEvent[]> {
    this.trace.record({ type: 'core.called', surface: this.surface })
    const events: DomainEvent[] = []
    for await (const event of this.core.run(command)) {
      events.push(event)
      this.trace.record({
        type: 'event.received',
        surface: this.surface,
        event: event.type,
      })
    }
    return events
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.trace.record({ type: 'surface.closed', surface: this.surface })
  }
}

function promptCommand(text: string): RuntimeCommand {
  if (text.trim() === '') throw new Error('prompt must not be empty')
  return { type: 'prompt', text }
}

function projectInteractive(event: DomainEvent): string {
  switch (event.type) {
    case 'progress':
      return `status: ${event.text}`
    case 'result':
      return `assistant: ${event.text}`
    case 'failure':
      return `error: ${event.message}`
    default:
      return assertNever(event)
  }
}

export class InteractiveSurface extends BaseSurface {
  constructor(core: RuntimeCore, trace?: SurfaceTrace) {
    super('interactive', core, trace)
  }

  async submit(prompt: string): Promise<SurfaceRun> {
    this.ensureOpen()
    let command: RuntimeCommand
    try {
      command = promptCommand(prompt)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.trace.record({ type: 'input.rejected', surface: this.surface, reason })
      throw error
    }
    this.trace.record({ type: 'input.accepted', surface: this.surface })
    const events = await this.callCore(command)
    const output = events.map(projectInteractive)
    for (const _line of output) {
      this.trace.record({
        type: 'output.projected',
        surface: this.surface,
        format: 'display',
      })
    }
    return { events, output }
  }
}

export type HeadlessInputFormat = 'text' | 'stream-json'
export type HeadlessOutputFormat = 'text' | 'json' | 'stream-json'

type StreamUserMessage = {
  type: 'user'
  message: { role: 'user'; content: string }
}

function parseStreamCommands(payload: string): RuntimeCommand[] {
  const lines = payload.split(/\r?\n/).filter(line => line.length > 0)
  if (lines.length === 0) throw new Error('stream input must contain a message')
  return lines.map(line => {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      throw new Error('invalid NDJSON')
    }
    if (typeof value !== 'object' || value === null) {
      throw new Error('invalid user message')
    }
    const candidate = value as Partial<StreamUserMessage>
    if (
      candidate.type !== 'user' ||
      candidate.message?.role !== 'user' ||
      typeof candidate.message.content !== 'string'
    ) {
      throw new Error('invalid user message')
    }
    return promptCommand(candidate.message.content)
  })
}

function projectText(events: readonly DomainEvent[]): string[] {
  const terminal = [...events].reverse().find(event => event.type !== 'progress')
  if (!terminal) throw new Error('headless run produced no terminal event')
  switch (terminal.type) {
    case 'result':
      return [terminal.text]
    case 'failure':
      return [`Execution error: ${terminal.message}`]
    default:
      return assertNever(terminal)
  }
}

function projectHeadless(
  events: readonly DomainEvent[],
  format: HeadlessOutputFormat,
): string[] {
  switch (format) {
    case 'text':
      return projectText(events)
    case 'json':
      return [JSON.stringify({ type: 'result', events })]
    case 'stream-json':
      return events.map(event => `${JSON.stringify(event)}\n`)
    default:
      return assertNever(format)
  }
}

export class HeadlessSurface extends BaseSurface {
  constructor(core: RuntimeCore, trace?: SurfaceTrace) {
    super('headless', core, trace)
  }

  async submit(
    payload: string,
    options: {
      inputFormat: HeadlessInputFormat
      outputFormat: HeadlessOutputFormat
    },
  ): Promise<SurfaceRun> {
    this.ensureOpen()
    let commands: RuntimeCommand[]
    try {
      commands =
        options.inputFormat === 'text'
          ? [promptCommand(payload)]
          : parseStreamCommands(payload)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.trace.record({ type: 'input.rejected', surface: this.surface, reason })
      throw error
    }

    const events: DomainEvent[] = []
    for (const command of commands) {
      this.trace.record({ type: 'input.accepted', surface: this.surface })
      events.push(...(await this.callCore(command)))
    }
    const output = projectHeadless(events, options.outputFormat)
    for (const _line of output) {
      this.trace.record({
        type: 'output.projected',
        surface: this.surface,
        format: options.outputFormat,
      })
    }
    return { events, output }
  }
}

function assertNever(value: never): never {
  const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value)
  throw new Error(`unknown surface value: ${rendered}`)
}
