import {
  CapabilityProjector,
  type CapabilityCatalog,
} from '../capabilityProjection.ts'
import {
  ConversationStore,
  MessageInvariantError,
  envelopeId,
  responseId,
  textBlock,
  toolUseBlock,
  toolUseId,
  type AssistantBlock,
  type AssistantMessage,
  type ConversationRunLease,
  type ConversationSnapshot,
  type ToolResultMessage,
} from '../conversationStore.ts'
import {
  createRequestContext,
  type RuntimeContext,
  type SessionStateStore,
} from '../runtimeContext.ts'
import type { ModelAdapter, ModelResponse, ModelUsage } from './model.ts'
import type { PermissionGate } from './permissions.ts'
import {
  RequestProjector,
  type RequestProjectionPolicy,
} from './requestProjector.ts'
import { TraceRecorder } from './trace.ts'
import { ToolScheduler } from './toolScheduler.ts'
import { AgentToolRegistry, type ToolProgress } from './tools.ts'

export type AgentRunStatus = 'completed' | 'cancelled' | 'failed' | 'max-turns'

export type AgentRunSummary = Readonly<{
  runId: string
  status: AgentRunStatus
  turns: number
  conversationRevision: number
  finalText?: string
  error?: string
  usage: Readonly<{
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }>
}>

export type AgentEvent =
  | Readonly<{ type: 'run.started'; runId: string }>
  | Readonly<{ type: 'assistant.text'; runId: string; text: string }>
  | Readonly<{ type: 'tool.started'; runId: string; toolName: string; toolUseId: string }>
  | Readonly<{
      type: 'tool.progress'
      runId: string
      toolName: string
      toolUseId: string
      progress: ToolProgress
    }>
  | Readonly<{
      type: 'tool.finished'
      runId: string
      toolName: string
      toolUseId: string
      status: 'success' | 'error' | 'denied' | 'cancelled'
    }>
  | Readonly<{ type: 'run.finished'; runId: string; status: AgentRunStatus }>

export interface AgentEventSink {
  emit(event: AgentEvent): void | Promise<void>
}

export interface IdSource {
  next(prefix: string): string
}

export class MonotonicIdSource implements IdSource {
  #next = 1

  next(prefix: string): string {
    return `${prefix}-${this.#next++}`
  }
}

export type AgentRuntimeOptions = Readonly<{
  model: ModelAdapter
  tools: AgentToolRegistry
  permissionGate: PermissionGate
  catalog: CapabilityCatalog
  runtimeContext: RuntimeContext
  sessionState: SessionStateStore
  workspace: string
  mode: 'interactive' | 'headless'
  maxTurns?: number
  maxToolConcurrency?: number
  conversation?: ConversationStore
  capabilityProjector?: CapabilityProjector
  trace: TraceRecorder
  events?: AgentEventSink
  ids?: IdSource
  systemPrompt?: string
  requestProjectionPolicy?: RequestProjectionPolicy
}>

export class AgentRuntime {
  readonly #model: ModelAdapter
  readonly #tools: AgentToolRegistry
  readonly #permissionGate: PermissionGate
  readonly #catalog: CapabilityCatalog
  readonly #runtimeContext: RuntimeContext
  readonly #sessionState: SessionStateStore
  readonly #workspace: string
  readonly #mode: 'interactive' | 'headless'
  readonly #maxTurns: number
  readonly #toolScheduler: ToolScheduler
  readonly #conversation: ConversationStore
  readonly #capabilityProjector: CapabilityProjector
  readonly #requestProjector: RequestProjector
  readonly #requestProjectionPolicy: RequestProjectionPolicy
  readonly #trace: TraceRecorder
  readonly #events?: AgentEventSink
  readonly #ids: IdSource

  constructor(options: AgentRuntimeOptions) {
    if (!options.workspace.trim()) throw new Error('workspace must not be empty')
    const maxTurns = options.maxTurns ?? 8
    if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 32) {
      throw new Error('maxTurns must be an integer from 1 to 32')
    }
    this.#model = options.model
    this.#tools = options.tools
    this.#permissionGate = options.permissionGate
    this.#catalog = options.catalog
    this.#runtimeContext = options.runtimeContext
    this.#sessionState = options.sessionState
    this.#workspace = options.workspace
    this.#mode = options.mode
    this.#maxTurns = maxTurns
    this.#toolScheduler = new ToolScheduler(options.tools, options.maxToolConcurrency ?? 4)
    this.#conversation = options.conversation ?? new ConversationStore()
    this.#capabilityProjector = options.capabilityProjector ?? new CapabilityProjector()
    this.#requestProjector = new RequestProjector(this.#conversation)
    this.#requestProjectionPolicy = Object.freeze({
      ...options.requestProjectionPolicy,
    })
    this.#trace = options.trace
    this.#events = options.events
    this.#ids = options.ids ?? new MonotonicIdSource()

    const systemPrompt = options.systemPrompt?.trim()
    if (systemPrompt) {
      if (this.#conversation.snapshot().messages.length > 0) {
        throw new Error('systemPrompt can only initialize an empty conversation')
      }
    }
    this.#conversation.bindRuntime(this)
    if (systemPrompt) {
      this.#conversation.append(0, [Object.freeze({
        kind: 'system',
        id: envelopeId(this.#ids.next('message')),
        text: systemPrompt,
      })])
    }
  }

  conversationSnapshot(): ConversationSnapshot {
    return this.#conversation.snapshot()
  }

  async submit(input: string, signal: AbortSignal): Promise<AgentRunSummary> {
    if (!input.trim()) throw new Error('input must not be empty')
    const runId = this.#ids.next('run')
    const runLease = this.#conversation.acquireRun(this)
    const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    let turns = 0

    try {
      await this.#trace.record(runId, 'run.started', { mode: this.#mode })
      await this.#emit(Object.freeze({ type: 'run.started', runId }))
      this.#appendHuman(input, runLease)
      await this.#trace.record(runId, 'input.committed', {
        conversationRevision: this.#conversation.revision,
        inputLength: input.length,
      })

      for (turns = 1; turns <= this.#maxTurns; turns++) {
        if (signal.aborted) return await this.#cancelled(runId, turns - 1, usage, 'before-request')

        const catalog = this.#catalog.snapshot()
        const requestId = this.#ids.next('request')
        const capabilities = this.#capabilityProjector.project(catalog, {
          boundary: requestId,
          mode: this.#mode,
          provider: this.#model.provider,
          model: this.#model.model,
        })
        const visibleNames = new Set(capabilities.schemas.map(schema => schema.name))
        const definitions = this.#tools.definitions(visibleNames)
        const conversation = this.#conversation.snapshot()
        this.#sessionState.publish({
          ...this.#sessionState.getState().values,
          mode: this.#mode,
          conversationRevision: conversation.revision,
          capabilityCatalogRevision: catalog.revision,
        })
        const requestContext = createRequestContext(
          this.#runtimeContext,
          this.#sessionState,
          requestId,
        )
        const projection = this.#requestProjector.projectWithReport(
          {
            requestContext,
            conversation,
            capabilities,
            tools: definitions,
            model: this.#model.model,
          },
          this.#requestProjectionPolicy,
        )
        const request = projection.request
        await this.#trace.record(runId, 'request.projected', {
          requestId,
          turn: turns,
          messageCount: request.messages.length,
          toolCount: request.tools.length,
          conversationRevision: conversation.revision,
          sessionRevision: requestContext.sessionRevision,
          sourceMessageCount: projection.report.sourceCount,
          selectedMessageCount: projection.report.selectedCount,
          omittedBeforeHistoryStart: projection.report.omittedBeforeHistoryStart,
          replacedToolResultCount: projection.report.replacedToolResultCount,
          userContextInjected: projection.report.userContextInjected,
          strictValidation: projection.report.strictValidation,
        })

        let response: ModelResponse
        try {
          await this.#trace.record(runId, 'model.started', { requestId, turn: turns })
          response = await this.#model.complete(request, signal)
          if (signal.aborted) {
            return await this.#cancelled(runId, turns, usage, 'model')
          }
          addUsage(usage, response.usage)
          await this.#trace.record(runId, 'model.completed', {
            requestId,
            turn: turns,
            toolCallCount: response.toolCalls.length,
            outputLength: response.text?.length ?? 0,
          })
        } catch (error) {
          if (signal.aborted) return await this.#cancelled(runId, turns, usage, 'model')
          return await this.#failed(runId, turns, usage, safeError(error))
        }

        const assistant = this.#appendAssistant(response, conversation.revision, runLease)
        await this.#trace.record(runId, 'assistant.committed', {
          responseId: response.responseId,
          messageId: assistant.id,
          conversationRevision: this.#conversation.revision,
          toolCallCount: response.toolCalls.length,
        })
        if (response.text) {
          await this.#emit(Object.freeze({
            type: 'assistant.text',
            runId,
            text: response.text,
          }))
        }
        if (response.toolCalls.length === 0) {
          return await this.#completed(runId, turns, usage, response.text)
        }

        const plan = this.#toolScheduler.plan(response.toolCalls, visibleNames)
        await this.#trace.record(runId, 'tools.planned', {
          turn: turns,
          batchCount: plan.batches.length,
          concurrentBatchCount: plan.batches.filter(batch => batch.mode === 'concurrent').length,
          exclusiveBatchCount: plan.batches.filter(batch => batch.mode === 'exclusive').length,
          maxConcurrency: plan.maxConcurrency,
        })
        const initialToolContext = asRecord(
          this.#sessionState.getState().values.toolExecutionContext,
        )
        const execution = await this.#toolScheduler.execute(plan, {
          workspace: this.#workspace,
          signal,
          gate: this.#permissionGate,
          visibleNames,
          initialContext: initialToolContext,
          hooks: {
            started: async call => {
              await this.#emit(Object.freeze({
                type: 'tool.started',
                runId,
                toolName: call.name,
                toolUseId: call.id,
              }))
              await this.#trace.record(runId, 'tool.started', {
                toolName: call.name,
                toolUseId: call.id,
                turn: turns,
              })
            },
            progress: async (call, progress) => {
              await this.#trace.record(runId, 'tool.progress', {
                toolName: call.name,
                toolUseId: call.id,
                stage: progress.stage,
                ...(progress.completed === undefined ? {} : { completed: progress.completed }),
                ...(progress.total === undefined ? {} : { total: progress.total }),
              })
              await this.#emit(Object.freeze({
                type: 'tool.progress',
                runId,
                toolName: call.name,
                toolUseId: call.id,
                progress,
              }))
            },
          },
        })

        let expectedRevision = this.#conversation.revision
        for (const outcome of execution.outcomes) {
          this.#appendToolResult(
            outcome.call.id,
            outcome.output,
            outcome.isError,
            assistant,
            expectedRevision,
            runLease,
          )
          expectedRevision = this.#conversation.revision
          await this.#toolFinished(
            runId,
            outcome.call.name,
            outcome.call.id,
            outcome.status,
            outcome.reason,
          )
        }
        this.#sessionState.publish({
          ...this.#sessionState.getState().values,
          toolExecutionContext: execution.context,
        })
        if (signal.aborted) return await this.#cancelled(runId, turns, usage, 'tool')
      }

      await this.#trace.record(runId, 'run.max-turns', { maxTurns: this.#maxTurns })
      return await this.#finish(runId, 'max-turns', this.#maxTurns, usage)
    } catch (error) {
      if (signal.aborted) return await this.#cancelled(runId, turns, usage, 'runtime')
      return await this.#failed(runId, turns, usage, safeError(error))
    } finally {
      this.#conversation.releaseRun(this, runLease)
    }
  }

  #appendHuman(text: string, runLease: ConversationRunLease): void {
    this.#conversation.append(this.#conversation.revision, [Object.freeze({
      kind: 'human',
      id: envelopeId(this.#ids.next('message')),
      text,
    })], runLease)
  }

  #appendAssistant(
    response: ModelResponse,
    expectedRevision: number,
    runLease: ConversationRunLease,
  ): AssistantMessage {
    const blocks: AssistantBlock[] = []
    if (response.text) blocks.push(textBlock(response.text))
    for (const call of response.toolCalls) {
      blocks.push(toolUseBlock(toolUseId(call.id), call.name, structuredClone(call.input)))
    }
    if (blocks.length === 0) throw new MessageInvariantError('assistant response has no blocks')
    const message = Object.freeze({
      kind: 'assistant' as const,
      id: envelopeId(this.#ids.next('message')),
      responseId: responseId(response.responseId),
      blocks: Object.freeze(blocks),
    })
    this.#conversation.append(expectedRevision, [message], runLease)
    return message
  }

  #appendToolResult(
    rawToolUseId: string,
    output: string,
    isError: boolean,
    assistant: AssistantMessage,
    expectedRevision: number,
    runLease: ConversationRunLease,
  ): void {
    this.#appendToolResultMessage(
      rawToolUseId,
      output,
      isError,
      assistant,
      expectedRevision,
      runLease,
    )
  }

  #appendToolResultMessage(
    rawToolUseId: string,
    output: string,
    isError: boolean,
    assistant: AssistantMessage,
    expectedRevision: number,
    runLease: ConversationRunLease,
  ): void {
    const message: ToolResultMessage = Object.freeze({
      kind: 'tool-result',
      id: envelopeId(this.#ids.next('message')),
      toolUseId: toolUseId(rawToolUseId),
      output,
      isError,
      parentId: assistant.id,
    })
    this.#conversation.append(expectedRevision, [message], runLease)
  }

  async #toolFinished(
    runId: string,
    toolName: string,
    rawToolUseId: string,
    status: 'success' | 'error' | 'denied' | 'cancelled',
    reason: string,
  ): Promise<void> {
    await this.#trace.record(runId, 'tool.finished', {
      toolName,
      toolUseId: rawToolUseId,
      status,
      reason,
      conversationRevision: this.#conversation.revision,
    })
    await this.#emit(Object.freeze({
      type: 'tool.finished',
      runId,
      toolName,
      toolUseId: rawToolUseId,
      status,
    }))
  }

  async #completed(
    runId: string,
    turns: number,
    usage: MutableUsage,
    finalText?: string,
  ): Promise<AgentRunSummary> {
    await this.#trace.record(runId, 'run.completed', { turns })
    return this.#finish(runId, 'completed', turns, usage, finalText)
  }

  async #cancelled(
    runId: string,
    turns: number,
    usage: MutableUsage,
    phase: string,
  ): Promise<AgentRunSummary> {
    await this.#trace.record(runId, 'run.cancelled', { phase, turns })
    return this.#finish(runId, 'cancelled', Math.max(0, turns), usage)
  }

  async #failed(
    runId: string,
    turns: number,
    usage: MutableUsage,
    error: string,
  ): Promise<AgentRunSummary> {
    await this.#trace.record(runId, 'run.failed', {
      turns: Math.max(0, turns),
      errorCategory: 'runtime',
    })
    return this.#finish(runId, 'failed', Math.max(0, turns), usage, undefined, error)
  }

  async #finish(
    runId: string,
    status: AgentRunStatus,
    turns: number,
    usage: MutableUsage,
    finalText?: string,
    error?: string,
  ): Promise<AgentRunSummary> {
    await this.#emit(Object.freeze({ type: 'run.finished', runId, status }))
    return Object.freeze({
      runId,
      status,
      turns,
      conversationRevision: this.#conversation.revision,
      ...(finalText ? { finalText } : {}),
      ...(error ? { error } : {}),
      usage: Object.freeze({ ...usage }),
    })
  }

  async #emit(event: AgentEvent): Promise<void> {
    if (!this.#events) return
    try {
      await this.#events.emit(event)
    } catch {
      await this.#trace.record(event.runId, 'event-sink.failed', {
        eventType: event.type,
      })
    }
  }
}

type MutableUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

function addUsage(target: MutableUsage, usage: ModelUsage | undefined): void {
  if (!usage) return
  target.inputTokens += usage.inputTokens ?? 0
  target.outputTokens += usage.outputTokens ?? 0
  target.totalTokens += usage.totalTokens ??
    (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
}

function safeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : Object.freeze({})
}
