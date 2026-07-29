export type HarnessMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'progress'; text: string }

export type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'completed' }
  | { status: 'failed'; error: string }
  | { status: 'cancelled'; reason: string }

export type H0EventInput =
  | { type: 'run.state'; status: RunState['status'] }
  | { type: 'call.entered'; source: string; target: string }
  | { type: 'message.appended'; owner: 'H0Harness'; kind: HarnessMessage['kind']; size: number }
  | { type: 'view.snapshotted'; owner: 'H0Harness'; size: number }
  | { type: 'query.event'; kind: HarnessMessage['kind'] }
  | { type: 'branch.skipped'; branch: 'query'; reason: string }
  | { type: 'cancel.requested'; reason: string }
  | { type: 'run.failed'; message: string }
  | { type: 'cleanup.finished' }

export type H0Event = H0EventInput & { seq: number }

export class TraceLog {
  readonly events: H0Event[] = []
  #nextSeq = 1

  record(event: H0EventInput): void {
    this.events.push({ ...event, seq: this.#nextSeq++ } as H0Event)
  }
}

const allowedTransitions: Record<RunState['status'], RunState['status'][]> = {
  idle: ['running'],
  running: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

export function transition(_current: RunState, next: RunState): RunState {
  if (!allowedTransitions[_current.status].includes(next.status)) {
    throw new Error(`invalid transition: ${_current.status} -> ${next.status}`)
  }
  return next
}

export function parseMessage(value: unknown): HarnessMessage {
  if (typeof value !== 'object' || value === null) {
    throw new Error('message must be an object')
  }
  const candidate = value as Record<string, unknown>
  if (
    (candidate.kind === 'user' ||
      candidate.kind === 'assistant' ||
      candidate.kind === 'progress') &&
    typeof candidate.text === 'string'
  ) {
    return { kind: candidate.kind, text: candidate.text }
  }
  throw new Error('invalid message')
}

export class ResourceScope {
  #disposers: Array<() => void | Promise<void>> = []
  #disposed = false

  register(disposer: () => void | Promise<void>): void {
    if (this.#disposed) throw new Error('resource scope already disposed')
    this.#disposers.push(disposer)
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return
    this.#disposed = true
    for (const disposer of this.#disposers.reverse()) await disposer()
    this.#disposers = []
  }
}

export class CancellationScope {
  readonly #controller = new AbortController()
  readonly #parent: AbortSignal | undefined
  readonly #forwardParent: () => void
  #timer: ReturnType<typeof setTimeout> | undefined

  constructor(parent?: AbortSignal, timeoutMs?: number) {
    this.#parent = parent
    this.#forwardParent = () => this.cancel(String(parent?.reason ?? 'parent'))
    if (parent?.aborted) {
      this.#forwardParent()
    } else {
      parent?.addEventListener('abort', this.#forwardParent, { once: true })
      if (timeoutMs !== undefined) {
        this.#timer = setTimeout(() => this.cancel('timeout'), timeoutMs)
        this.#timer.unref?.()
      }
    }
  }

  get signal(): AbortSignal {
    return this.#controller.signal
  }

  cancel(reason: string): void {
    if (!this.signal.aborted) this.#controller.abort(reason)
  }

  cleanup(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#parent?.removeEventListener('abort', this.#forwardParent)
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
  signal: AbortSignal,
) => AsyncIterable<HarnessMessage>

export class H0Harness {
  #messages: HarnessMessage[] = []
  #state: RunState = { status: 'idle' }
  readonly #processInput: ProcessInput
  readonly #queryStream: QueryStream
  readonly trace = new TraceLog()

  constructor(processInput: ProcessInput, queryStream: QueryStream) {
    this.#processInput = processInput
    this.#queryStream = queryStream
  }

  get state(): RunState {
    return this.#state
  }

  get messages(): readonly HarnessMessage[] {
    return [...this.#messages]
  }

  #setState(next: RunState): void {
    this.#state = transition(this.#state, next)
    this.trace.record({ type: 'run.state', status: next.status })
  }

  async *run(
    prompt: string,
    options: { parentSignal?: AbortSignal; timeoutMs?: number } = {},
  ): AsyncGenerator<HarnessMessage, void> {
    const cancellation = new CancellationScope(
      options.parentSignal,
      options.timeoutMs,
    )
    const resources = new ResourceScope()
    resources.register(() => cancellation.cleanup())
    const onAbort = (): void => {
      this.trace.record({
        type: 'cancel.requested',
        reason: String(cancellation.signal.reason ?? 'cancelled'),
      })
    }
    cancellation.signal.addEventListener('abort', onAbort, { once: true })
    resources.register(() => cancellation.signal.removeEventListener('abort', onAbort))

    this.#setState({ status: 'running' })
    try {
      this.trace.record({
        type: 'call.entered',
        source: 'H0Harness.run',
        target: 'processInput',
      })
      const processed = await this.#processInput(prompt, [...this.#messages])
      for (const message of processed.messages) {
        this.#messages.push(message)
        this.trace.record({
          type: 'message.appended',
          owner: 'H0Harness',
          kind: message.kind,
          size: this.#messages.length,
        })
      }
      const requestView = [...this.#messages]
      this.trace.record({
        type: 'view.snapshotted',
        owner: 'H0Harness',
        size: requestView.length,
      })

      if (cancellation.signal.aborted) {
        this.#setState({
          status: 'cancelled',
          reason: String(cancellation.signal.reason ?? 'cancelled'),
        })
        return
      }
      if (!processed.shouldQuery) {
        this.trace.record({
          type: 'branch.skipped',
          branch: 'query',
          reason: 'processInput.shouldQuery=false',
        })
        this.#setState({ status: 'completed' })
        return
      }

      this.trace.record({
        type: 'call.entered',
        source: 'H0Harness.run',
        target: 'queryStream',
      })
      for await (const message of this.#queryStream(
        requestView,
        cancellation.signal,
      )) {
        if (cancellation.signal.aborted) break
        this.trace.record({ type: 'query.event', kind: message.kind })
        this.#messages.push(message)
        this.trace.record({
          type: 'message.appended',
          owner: 'H0Harness',
          kind: message.kind,
          size: this.#messages.length,
        })
        yield message
      }

      if (cancellation.signal.aborted) {
        this.#setState({
          status: 'cancelled',
          reason: String(cancellation.signal.reason ?? 'cancelled'),
        })
      } else {
        this.#setState({ status: 'completed' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.trace.record({ type: 'run.failed', message })
      this.#setState({ status: 'failed', error: message })
      throw error
    } finally {
      await resources.dispose()
      this.trace.record({ type: 'cleanup.finished' })
    }
  }
}

export async function collect(
  stream: AsyncIterable<HarnessMessage>,
): Promise<HarnessMessage[]> {
  const messages: HarnessMessage[] = []
  for await (const message of stream) messages.push(message)
  return messages
}
