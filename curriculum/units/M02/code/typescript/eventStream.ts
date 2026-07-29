export type HarnessEvent =
  | { type: 'run.started'; runId: string }
  | { type: 'model.delta'; text: string }
  | { type: 'tool.progress'; toolUseId: string; percent: number }
  | { type: 'run.completed'; runId: string }

export type RunSummary = {
  runId: string
  yielded: number
}

export type StreamOptions = {
  failAfterDelta?: boolean
}

export async function* runEventStream(
  runId: string,
  trace: string[],
  options: StreamOptions = {},
): AsyncGenerator<HarnessEvent, RunSummary, void> {
  let yielded = 0
  trace.push('producer.started')
  try {
    trace.push('producer.before:start')
    yielded += 1
    yield { type: 'run.started', runId }
    trace.push('producer.after:start')

    trace.push('producer.before:delta')
    yielded += 1
    yield { type: 'model.delta', text: 'hello' }
    trace.push('producer.after:delta')

    if (options.failAfterDelta) {
      throw new Error('scripted producer failure')
    }

    trace.push('producer.before:complete')
    yielded += 1
    yield { type: 'run.completed', runId }
    trace.push('producer.after:complete')
    return { runId, yielded }
  } finally {
    trace.push('producer.finally')
  }
}

export async function* delegatedRun(
  runId: string,
  trace: string[],
): AsyncGenerator<HarnessEvent, RunSummary, void> {
  trace.push('delegate.started')
  try {
    const summary = yield* runEventStream(runId, trace)
    trace.push(`delegate.return:${summary.yielded}`)
    return summary
  } finally {
    trace.push('delegate.finally')
  }
}

export class PushAsyncQueue<T> implements AsyncIterableIterator<T> {
  private readonly queue: T[] = []
  private waiting?: {
    resolve: (result: IteratorResult<T>) => void
    reject: (error: unknown) => void
  }
  private closed = false
  private failure: unknown

  get bufferedCount(): number {
    return this.queue.length
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    return this
  }

  next(): Promise<IteratorResult<T>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ done: false, value: this.queue.shift()! })
    }
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject }
    })
  }

  enqueue(value: T): void {
    if (this.closed) throw new Error('queue is closed')
    if (this.waiting) {
      const waiting = this.waiting
      this.waiting = undefined
      waiting.resolve({ done: false, value })
      return
    }
    this.queue.push(value)
  }

  done(): void {
    this.closed = true
    this.waiting?.resolve({ done: true, value: undefined })
    this.waiting = undefined
  }

  error(error: unknown): void {
    this.failure = error
    this.waiting?.reject(error)
    this.waiting = undefined
  }

  return(): Promise<IteratorResult<T>> {
    this.closed = true
    this.queue.length = 0
    return Promise.resolve({ done: true, value: undefined })
  }
}
