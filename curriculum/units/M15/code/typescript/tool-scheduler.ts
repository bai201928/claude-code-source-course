export type Call = Readonly<{
  id: string
  name: string
  input: Readonly<Record<string, unknown>>
}>

export type Progress = Readonly<{ callId: string; stage: string }>
export type ContextUpdate = Readonly<Record<string, string>>

export type Tool = Readonly<{
  name: string
  parse(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>
  isConcurrencySafe(input: Readonly<Record<string, unknown>>): boolean
  permission(input: Readonly<Record<string, unknown>>): 'allow' | 'deny'
  run(
    input: Readonly<Record<string, unknown>>,
    report: (stage: string) => void,
    signal: AbortSignal,
  ): Promise<Readonly<{ output: string; update?: ContextUpdate }>>
}>

export type Batch = Readonly<{
  mode: 'concurrent' | 'exclusive'
  calls: readonly Call[]
}>

export type Outcome = Readonly<{
  callId: string
  status: 'success' | 'error' | 'denied' | 'cancelled'
  output: string
  update?: ContextUpdate
}>

export class Scheduler {
  readonly #tools: ReadonlyMap<string, Tool>
  readonly #limit: number

  constructor(tools: readonly Tool[], limit = 2) {
    this.#tools = new Map(tools.map(tool => [tool.name, tool]))
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be positive')
    this.#limit = limit
  }

  plan(calls: readonly Call[]): readonly Batch[] {
    const batches: Batch[] = []
    let safe: Call[] = []
    const flush = (): void => {
      if (safe.length === 0) return
      batches.push(Object.freeze({ mode: 'concurrent', calls: Object.freeze(safe) }))
      safe = []
    }
    for (const call of calls) {
      if (this.#classify(call)) {
        safe.push(call)
      } else {
        flush()
        batches.push(Object.freeze({ mode: 'exclusive', calls: Object.freeze([call]) }))
      }
    }
    flush()
    return Object.freeze(batches)
  }

  async execute(
    calls: readonly Call[],
    signal: AbortSignal,
    onProgress: (progress: Progress) => void = () => {},
  ): Promise<Readonly<{ outcomes: readonly Outcome[]; context: Readonly<Record<string, string>> }>> {
    const outcomes = new Map<string, Outcome>()
    let context: Readonly<Record<string, string>> = Object.freeze({})
    for (const batch of this.plan(calls)) {
      const completed = batch.mode === 'exclusive'
        ? [await this.#one(batch.calls[0]!, signal, onProgress)]
        : await this.#concurrent(batch.calls, signal, onProgress)
      for (const outcome of completed) outcomes.set(outcome.callId, outcome)
      for (const call of batch.calls) {
        const update = outcomes.get(call.id)?.update
        if (update) context = Object.freeze({ ...context, ...update })
      }
    }
    return Object.freeze({
      outcomes: Object.freeze(calls.map(call => outcomes.get(call.id)!)),
      context,
    })
  }

  #classify(call: Call): boolean {
    const tool = this.#tools.get(call.name)
    if (!tool) return false
    try {
      const parsed = tool.parse(call.input)
      return tool.isConcurrencySafe(parsed)
    } catch {
      return false
    }
  }

  async #concurrent(
    calls: readonly Call[],
    signal: AbortSignal,
    onProgress: (progress: Progress) => void,
  ): Promise<readonly Outcome[]> {
    const outcomes = new Array<Outcome>(calls.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const index = next++
        if (index >= calls.length) return
        outcomes[index] = await this.#one(calls[index]!, signal, onProgress)
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.#limit, calls.length) }, worker))
    return Object.freeze(outcomes)
  }

  async #one(
    call: Call,
    signal: AbortSignal,
    onProgress: (progress: Progress) => void,
  ): Promise<Outcome> {
    if (signal.aborted) return cancelled(call.id, 'cancelled before execution')
    const tool = this.#tools.get(call.name)
    if (!tool) return error(call.id, `unknown tool: ${call.name}`)
    let parsed: Readonly<Record<string, unknown>>
    try {
      parsed = tool.parse(call.input)
    } catch (reason) {
      return error(call.id, message(reason))
    }
    if (tool.permission(parsed) === 'deny') {
      return Object.freeze({ callId: call.id, status: 'denied', output: 'permission denied' })
    }
    try {
      const result = await tool.run(
        parsed,
        stage => onProgress(Object.freeze({ callId: call.id, stage })),
        signal,
      )
      if (signal.aborted) return cancelled(call.id, message(signal.reason))
      return Object.freeze({
        callId: call.id,
        status: 'success',
        output: result.output,
        ...(result.update ? { update: result.update } : {}),
      })
    } catch (reason) {
      return signal.aborted
        ? cancelled(call.id, message(reason))
        : error(call.id, message(reason))
    }
  }
}

export function compareSnapshotPolicies(
  calls: readonly Readonly<{ id: string; safe: boolean; update?: ContextUpdate }>[]
): Readonly<{
  responseCompleteContext: Readonly<Record<string, string>>
  streamingContext: Readonly<Record<string, string>>
}> {
  let responseCompleteContext: Readonly<Record<string, string>> = Object.freeze({})
  let streamingContext: Readonly<Record<string, string>> = Object.freeze({})
  for (const call of calls) {
    if (!call.update) continue
    responseCompleteContext = Object.freeze({ ...responseCompleteContext, ...call.update })
    if (!call.safe) streamingContext = Object.freeze({ ...streamingContext, ...call.update })
  }
  return Object.freeze({ responseCompleteContext, streamingContext })
}

function cancelled(callId: string, output: string): Outcome {
  return Object.freeze({ callId, status: 'cancelled', output })
}

function error(callId: string, output: string): Outcome {
  return Object.freeze({ callId, status: 'error', output })
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason ?? 'cancelled')
}
