import type { ModelToolCall } from './model.ts'
import { PermissionDeniedError } from './permissions.ts'
import {
  AgentToolRegistry,
  ToolExecutionError,
  ToolInputError,
  type ToolContextUpdate,
  type ToolDispatchResult,
  type ToolProgress,
} from './tools.ts'

export type ToolExecutionBatch = Readonly<{
  mode: 'concurrent' | 'exclusive'
  calls: readonly ModelToolCall[]
}>

export type ToolExecutionPlan = Readonly<{
  maxConcurrency: number
  batches: readonly ToolExecutionBatch[]
}>

export type ToolExecutionStatus = 'success' | 'error' | 'denied' | 'cancelled'

export type ToolExecutionOutcome = Readonly<{
  call: ModelToolCall
  status: ToolExecutionStatus
  output: string
  isError: boolean
  reason: string
  contextUpdate?: ToolContextUpdate
}>

export type ToolSchedulerHooks = Readonly<{
  started?(call: ModelToolCall): void | Promise<void>
  progress?(call: ModelToolCall, progress: ToolProgress): void | Promise<void>
}>

export class ToolScheduler {
  readonly #registry: AgentToolRegistry
  readonly #maxConcurrency: number

  constructor(registry: AgentToolRegistry, maxConcurrency = 4) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 32) {
      throw new Error('max tool concurrency must be an integer from 1 to 32')
    }
    this.#registry = registry
    this.#maxConcurrency = maxConcurrency
  }

  plan(calls: readonly ModelToolCall[], visibleNames: ReadonlySet<string>): ToolExecutionPlan {
    const batches: ToolExecutionBatch[] = []
    let safe: ModelToolCall[] = []
    const flushSafe = (): void => {
      if (safe.length === 0) return
      batches.push(Object.freeze({ mode: 'concurrent', calls: Object.freeze(safe) }))
      safe = []
    }
    for (const call of calls) {
      if (this.#registry.isConcurrencySafe(call.name, call.input, visibleNames)) {
        safe.push(call)
      } else {
        flushSafe()
        batches.push(Object.freeze({ mode: 'exclusive', calls: Object.freeze([call]) }))
      }
    }
    flushSafe()
    return Object.freeze({
      maxConcurrency: this.#maxConcurrency,
      batches: Object.freeze(batches),
    })
  }

  async execute(
    plan: ToolExecutionPlan,
    options: Readonly<{
      workspace: string
      signal: AbortSignal
      gate: Parameters<AgentToolRegistry['dispatch']>[3]
      visibleNames: ReadonlySet<string>
      initialContext?: Readonly<Record<string, unknown>>
      hooks?: ToolSchedulerHooks
    }>,
  ): Promise<Readonly<{
    outcomes: readonly ToolExecutionOutcome[]
    context: Readonly<Record<string, unknown>>
  }>> {
    const outcomes = new Map<string, ToolExecutionOutcome>()
    let context: Readonly<Record<string, unknown>> = Object.freeze({
      ...(options.initialContext ?? {}),
    })

    for (const batch of plan.batches) {
      const completed = batch.mode === 'exclusive'
        ? [await this.#executeOne(batch.calls[0]!, options)]
        : await this.#executeConcurrent(batch.calls, plan.maxConcurrency, options)
      for (const outcome of completed) outcomes.set(outcome.call.id, outcome)
      for (const call of batch.calls) {
        const update = outcomes.get(call.id)?.contextUpdate
        if (update) context = Object.freeze({ ...context, ...structuredClone(update) })
      }
    }

    return Object.freeze({
      outcomes: Object.freeze(plan.batches.flatMap(batch => batch.calls).map(call => outcomes.get(call.id)!)),
      context,
    })
  }

  async #executeConcurrent(
    calls: readonly ModelToolCall[],
    limit: number,
    options: Parameters<ToolScheduler['execute']>[1],
  ): Promise<readonly ToolExecutionOutcome[]> {
    const outcomes = new Array<ToolExecutionOutcome>(calls.length)
    let next = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const index = next++
        if (index >= calls.length) return
        outcomes[index] = await this.#executeOne(calls[index]!, options)
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, calls.length) }, worker))
    return Object.freeze(outcomes)
  }

  async #executeOne(
    call: ModelToolCall,
    options: Parameters<ToolScheduler['execute']>[1],
  ): Promise<ToolExecutionOutcome> {
    if (options.signal.aborted) return cancelledOutcome(call, 'cancelled before execution')
    await safeHook(() => options.hooks?.started?.(call))
    let result: ToolDispatchResult
    try {
      result = await this.#registry.dispatch(
        call.name,
        call.input,
        {
          workspace: options.workspace,
          signal: options.signal,
          reportProgress: progress => safeHook(() => options.hooks?.progress?.(call, progress)),
        },
        options.gate,
        options.visibleNames,
      )
      if (options.signal.aborted) return cancelledOutcome(call, safeError(options.signal.reason))
      return Object.freeze({
        call,
        status: 'success',
        output: serializeOutput(result.output),
        isError: false,
        reason: result.decision.reason,
        ...(result.contextUpdate ? { contextUpdate: result.contextUpdate } : {}),
      })
    } catch (error) {
      if (options.signal.aborted) return cancelledOutcome(call, safeError(error))
      const denied = error instanceof PermissionDeniedError
      return Object.freeze({
        call,
        status: denied ? 'denied' : 'error',
        output: safeError(error),
        isError: true,
        reason: denied ? error.decision.reason : safeErrorCategory(error),
      })
    }
  }
}

async function safeHook(operation: () => void | Promise<void> | undefined): Promise<void> {
  try {
    await operation()
  } catch {
    // Observer hooks never own execution or pairing.
  }
}

function cancelledOutcome(call: ModelToolCall, output: string): ToolExecutionOutcome {
  return Object.freeze({
    call,
    status: 'cancelled',
    output: output || 'operation cancelled',
    isError: true,
    reason: 'cancellation',
  })
}

function serializeOutput(value: unknown): string {
  const rendered = typeof value === 'string' ? value : JSON.stringify(value)
  if (rendered === undefined) return 'null'
  return rendered.length <= 200_000
    ? rendered
    : `${rendered.slice(0, 200_000)}\n[tool output truncated]`
}

function safeError(error: unknown): string {
  if (error instanceof PermissionDeniedError) return error.decision.reason
  if (error instanceof Error) return error.message
  return String(error ?? 'operation cancelled')
}

function safeErrorCategory(error: unknown): string {
  if (error instanceof ToolInputError) return 'tool-input'
  if (error instanceof ToolExecutionError) return 'tool-execution'
  return 'tool'
}
