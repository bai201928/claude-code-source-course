export type StreamTerminalStatus = 'completed' | 'cancelled' | 'failed'

export type StreamTerminal = Readonly<{
  status: StreamTerminalStatus
  itemCount: number
  errorCategory?: string
}>

export interface AgentRunStream<T> extends AsyncIterable<T> {
  readonly terminal: Promise<StreamTerminal>
  close(reason?: unknown): Promise<StreamTerminal>
}

export type StreamSource<T> =
  | AsyncIterable<T>
  | ((signal: AbortSignal) => AsyncIterable<T>)

type Waiter<T> = {
  resolve: (result: IteratorResult<T>) => void
}

/**
 * A pull stream with an explicit capacity and one consumer.
 * The producer is pulled only while the buffer has room; close aborts the
 * owner signal and waits for the source iterator's finally block.
 */
export class BoundedAgentRunStream<T> implements AgentRunStream<T> {
  readonly #capacity: number
  readonly #controller = new AbortController()
  readonly #queue: T[] = []
  readonly #waiters: Waiter<T>[] = []
  readonly #spaceWaiters: Array<() => void> = []
  readonly #terminalPromise: Promise<StreamTerminal>
  readonly #resolveTerminal: (terminal: StreamTerminal) => void
  readonly #producerDone: Promise<void>
  #iterator?: AsyncIterator<T>
  #consumerClaimed = false
  #closing = false
  #finished = false
  #itemCount = 0
  #terminal?: StreamTerminal

  constructor(source: StreamSource<T>, options?: { capacity?: number; parentSignal?: AbortSignal }) {
    const capacity = options?.capacity ?? 32
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1024) {
      throw new Error('stream capacity must be an integer from 1 to 1024')
    }
    this.#capacity = capacity
    let resolveTerminal!: (terminal: StreamTerminal) => void
    this.#terminalPromise = new Promise(resolve => { resolveTerminal = resolve })
    this.#resolveTerminal = resolveTerminal
    if (options?.parentSignal) {
      if (options.parentSignal.aborted) void this.close(options.parentSignal.reason)
      else options.parentSignal.addEventListener('abort', () => { void this.close(options.parentSignal!.reason) }, { once: true })
    }
    this.#producerDone = this.#pump(source)
  }

  get terminal(): Promise<StreamTerminal> {
    return this.#terminalPromise
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.#consumerClaimed) throw new Error('AgentRunStream supports one consumer')
    this.#consumerClaimed = true
    return {
      next: () => this.#next(),
      return: () => this.close('consumer closed').then(() => ({ value: undefined, done: true })),
    }
  }

  async close(reason?: unknown): Promise<StreamTerminal> {
    if (!this.#closing) {
      this.#closing = true
      this.#controller.abort(reason)
      try { await this.#iterator?.return?.() } catch { /* source cleanup is best effort */ }
      this.#wakeSpaceWaiters()
      this.#finishWaiters()
    }
    await this.#producerDone
    return (await this.#terminalPromise)
  }

  async #pump(source: StreamSource<T>): Promise<void> {
    try {
      const iterable = typeof source === 'function' ? source(this.#controller.signal) : source
      this.#iterator = iterable[Symbol.asyncIterator]()
      while (!this.#closing) {
        if (this.#queue.length >= this.#capacity) {
          await new Promise<void>(resolve => this.#spaceWaiters.push(resolve))
          continue
        }
        const result = await this.#iterator.next()
        if (result.done) break
        if (this.#closing) break
        this.#itemCount += 1
        const waiter = this.#waiters.shift()
        if (waiter) waiter.resolve({ value: result.value, done: false })
        else this.#queue.push(result.value)
      }
      this.#complete(this.#closing ? 'cancelled' : 'completed')
    } catch (error) {
      this.#complete(this.#closing || this.#controller.signal.aborted ? 'cancelled' : 'failed', error)
    } finally {
      this.#finishWaiters()
    }
  }

  async #next(): Promise<IteratorResult<T>> {
    if (this.#queue.length > 0) {
      const value = this.#queue.shift()!
      this.#wakeOneSpaceWaiter()
      return { value, done: false }
    }
    if (this.#finished || this.#closing) return { value: undefined, done: true }
    return await new Promise(resolve => this.#waiters.push({ resolve }))
  }

  #complete(status: StreamTerminalStatus, error?: unknown): void {
    if (this.#finished) return
    this.#finished = true
    this.#terminal = Object.freeze({
      status,
      itemCount: this.#itemCount,
      ...(status === 'failed' ? { errorCategory: error instanceof Error ? error.name : 'unknown' } : {}),
    })
    this.#resolveTerminal(this.#terminal)
  }

  #finishWaiters(): void {
    if (!this.#finished && !this.#closing) return
    while (this.#waiters.length > 0) this.#waiters.shift()!.resolve({ value: undefined, done: true })
  }

  #wakeOneSpaceWaiter(): void {
    this.#spaceWaiters.shift()?.()
  }

  #wakeSpaceWaiters(): void {
    while (this.#spaceWaiters.length > 0) this.#spaceWaiters.shift()!()
  }
}

