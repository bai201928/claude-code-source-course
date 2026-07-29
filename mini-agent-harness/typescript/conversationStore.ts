declare const envelopeIdBrand: unique symbol
declare const responseIdBrand: unique symbol
declare const toolUseIdBrand: unique symbol
declare const conversationRunLeaseBrand: unique symbol

export type EnvelopeId = string & { readonly [envelopeIdBrand]: 'EnvelopeId' }
export type ResponseId = string & { readonly [responseIdBrand]: 'ResponseId' }
export type ToolUseId = string & { readonly [toolUseIdBrand]: 'ToolUseId' }
export type ConversationRunLease = Readonly<{
  readonly [conversationRunLeaseBrand]: 'ConversationRunLease'
}>

export type TextBlock = Readonly<{
  kind: 'text'
  text: string
}>

export type ToolUseBlock = Readonly<{
  kind: 'tool-use'
  id: ToolUseId
  name: string
  input: Readonly<Record<string, unknown>>
}>

export type AssistantBlock = TextBlock | ToolUseBlock

export type HumanMessage = Readonly<{
  kind: 'human'
  id: EnvelopeId
  text: string
  parentId?: EnvelopeId
}>

export type AssistantMessage = Readonly<{
  kind: 'assistant'
  id: EnvelopeId
  responseId: ResponseId
  blocks: readonly AssistantBlock[]
  parentId?: EnvelopeId
}>

export type ToolResultMessage = Readonly<{
  kind: 'tool-result'
  id: EnvelopeId
  toolUseId: ToolUseId
  output: string
  isError: boolean
  parentId?: EnvelopeId
}>

export type SystemMessage = Readonly<{
  kind: 'system'
  id: EnvelopeId
  text: string
  parentId?: EnvelopeId
}>

export type DurableMessage =
  | HumanMessage
  | AssistantMessage
  | ToolResultMessage
  | SystemMessage

export type ProgressEvent = Readonly<{
  kind: 'progress'
  id: EnvelopeId
  toolUseId: ToolUseId
  detail: string
  sequence: number
}>

export type ConversationSnapshot = Readonly<{
  revision: number
  messages: readonly DurableMessage[]
}>

export type ConversationTrace = Readonly<{
  operation: 'append' | 'replace' | 'progress'
  status: 'committed' | 'rejected' | 'published'
  revision: number
  messageIds: readonly EnvelopeId[]
  reason?: string
}>

type ToolUseState = 'pending' | 'resolved'

type ValidatedState = Readonly<{
  messages: readonly DurableMessage[]
  envelopeIds: ReadonlySet<EnvelopeId>
  toolUses: ReadonlyMap<ToolUseId, ToolUseState>
}>

export class RevisionConflictError extends Error {}
export class MessageInvariantError extends Error {}
export class ConversationOwnershipError extends Error {}
export class ConversationRunActiveError extends Error {}

export class ConversationStore {
  #revision = 0
  #messages: readonly DurableMessage[] = Object.freeze([])
  #envelopeIds = new Set<EnvelopeId>()
  #toolUses = new Map<ToolUseId, ToolUseState>()
  #progressSequence = 0
  #trace: ConversationTrace[] = []
  #runtimeOwner?: object
  #activeRunLease?: ConversationRunLease

  constructor(initialMessages: readonly DurableMessage[] = []) {
    const validated = validateSequence(initialMessages)
    this.#messages = validated.messages
    this.#envelopeIds = new Set(validated.envelopeIds)
    this.#toolUses = new Map(validated.toolUses)
  }

  get revision(): number {
    return this.#revision
  }

  snapshot(): ConversationSnapshot {
    return Object.freeze({
      revision: this.#revision,
      messages: this.#messages,
    })
  }

  traces(): readonly ConversationTrace[] {
    return Object.freeze([...this.#trace])
  }

  bindRuntime(owner: object): void {
    if (this.#runtimeOwner === undefined) {
      this.#runtimeOwner = owner
      return
    }
    if (this.#runtimeOwner !== owner) {
      throw new ConversationOwnershipError(
        'conversation is already bound to another AgentRuntime',
      )
    }
  }

  acquireRun(owner: object): ConversationRunLease {
    if (this.#runtimeOwner !== owner) {
      throw new ConversationOwnershipError('AgentRuntime does not own this conversation')
    }
    if (this.#activeRunLease !== undefined) {
      throw new ConversationRunActiveError('conversation already has an active run')
    }
    const lease = Object.freeze({}) as ConversationRunLease
    this.#activeRunLease = lease
    return lease
  }

  releaseRun(owner: object, lease: ConversationRunLease): void {
    if (this.#runtimeOwner !== owner || this.#activeRunLease !== lease) {
      throw new ConversationOwnershipError('invalid conversation run lease release')
    }
    this.#activeRunLease = undefined
  }

  append(
    expectedRevision: number,
    incoming: readonly DurableMessage[],
    runLease?: ConversationRunLease,
  ): ConversationSnapshot {
    this.#requireWriteAccess(runLease)
    this.#requireRevision(expectedRevision, 'append')
    try {
      const validated = validateSequence(incoming, {
        messages: this.#messages,
        envelopeIds: this.#envelopeIds,
        toolUses: this.#toolUses,
      })
      return this.#commit('append', validated, incoming.map(item => item.id))
    } catch (error) {
      this.#recordRejection('append', incoming.map(item => item.id), error)
      throw error
    }
  }

  replace(
    expectedRevision: number,
    replacement: readonly DurableMessage[],
    runLease?: ConversationRunLease,
  ): ConversationSnapshot {
    this.#requireWriteAccess(runLease)
    this.#requireRevision(expectedRevision, 'replace')
    try {
      const validated = validateSequence(replacement)
      return this.#commit(
        'replace',
        validated,
        replacement.map(item => item.id),
      )
    } catch (error) {
      this.#recordRejection('replace', replacement.map(item => item.id), error)
      throw error
    }
  }

  publishProgress(
    id: EnvelopeId,
    toolUseId: ToolUseId,
    detail: string,
  ): ProgressEvent {
    requireNonEmpty(id, 'progress envelope id')
    requireNonEmpty(detail, 'progress detail')
    if (this.#toolUses.get(toolUseId) !== 'pending') {
      const error = new MessageInvariantError(
        `progress requires a pending tool use: ${toolUseId}`,
      )
      this.#recordRejection('progress', [id], error)
      throw error
    }
    this.#progressSequence += 1
    const event = deepFreeze({
      kind: 'progress' as const,
      id,
      toolUseId,
      detail,
      sequence: this.#progressSequence,
    })
    this.#trace.push(
      Object.freeze({
        operation: 'progress',
        status: 'published',
        revision: this.#revision,
        messageIds: Object.freeze([id]),
      }),
    )
    return event
  }

  assertRequestReady(snapshot: ConversationSnapshot): void {
    if (snapshot.revision > this.#revision) {
      throw new MessageInvariantError('snapshot revision is from the future')
    }

    const waiting = new Set<ToolUseId>()
    for (const message of snapshot.messages) {
      if (message.kind === 'assistant') {
        if (waiting.size > 0) {
          throw new MessageInvariantError(
            `missing tool results before assistant message: ${[...waiting].join(',')}`,
          )
        }
        for (const block of message.blocks) {
          if (block.kind === 'tool-use') waiting.add(block.id)
        }
        continue
      }

      if (message.kind === 'tool-result') {
        if (!waiting.delete(message.toolUseId)) {
          throw new MessageInvariantError(
            `orphan or duplicate tool result: ${message.toolUseId}`,
          )
        }
        continue
      }

      if (waiting.size > 0) {
        throw new MessageInvariantError(
          `tool results must immediately follow their assistant: ${[...waiting].join(',')}`,
        )
      }
    }

    if (waiting.size > 0) {
      throw new MessageInvariantError(
        `request has unresolved tool uses: ${[...waiting].join(',')}`,
      )
    }
  }

  #requireRevision(
    expectedRevision: number,
    operation: 'append' | 'replace',
  ): void {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new RevisionConflictError('expected revision must be a non-negative integer')
    }
    if (expectedRevision === this.#revision) return
    const error = new RevisionConflictError(
      `stale ${operation}: expected revision ${expectedRevision}, current revision ${this.#revision}`,
    )
    this.#recordRejection(operation, [], error)
    throw error
  }

  #requireWriteAccess(runLease: ConversationRunLease | undefined): void {
    if (this.#activeRunLease !== undefined && runLease !== this.#activeRunLease) {
      throw new ConversationRunActiveError(
        'conversation writes require the active AgentRuntime run lease',
      )
    }
  }

  #commit(
    operation: 'append' | 'replace',
    validated: ValidatedState,
    messageIds: readonly EnvelopeId[],
  ): ConversationSnapshot {
    this.#messages = validated.messages
    this.#envelopeIds = new Set(validated.envelopeIds)
    this.#toolUses = new Map(validated.toolUses)
    this.#revision += 1
    this.#trace.push(
      Object.freeze({
        operation,
        status: 'committed',
        revision: this.#revision,
        messageIds: Object.freeze([...messageIds]),
      }),
    )
    return this.snapshot()
  }

  #recordRejection(
    operation: 'append' | 'replace' | 'progress',
    messageIds: readonly EnvelopeId[],
    error: unknown,
  ): void {
    this.#trace.push(
      Object.freeze({
        operation,
        status: 'rejected',
        revision: this.#revision,
        messageIds: Object.freeze([...messageIds]),
        reason: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}

export function envelopeId(value: string): EnvelopeId {
  return brand(value, 'envelope id') as EnvelopeId
}

export function responseId(value: string): ResponseId {
  return brand(value, 'response id') as ResponseId
}

export function toolUseId(value: string): ToolUseId {
  return brand(value, 'tool use id') as ToolUseId
}

export function textBlock(text: string): TextBlock {
  requireNonEmpty(text, 'text block')
  return Object.freeze({ kind: 'text', text })
}

export function toolUseBlock(
  id: ToolUseId,
  name: string,
  input: Record<string, unknown>,
): ToolUseBlock {
  requireNonEmpty(id, 'tool use id')
  requireNonEmpty(name, 'tool name')
  return deepFreeze({ kind: 'tool-use', id, name, input: cloneData(input) })
}

export function isHumanInput(message: DurableMessage): message is HumanMessage {
  return message.kind === 'human'
}

export function groupAssistantFragments(
  messages: readonly DurableMessage[],
): ReadonlyMap<ResponseId, readonly AssistantMessage[]> {
  const groups = new Map<ResponseId, AssistantMessage[]>()
  for (const message of messages) {
    if (message.kind !== 'assistant') continue
    const group = groups.get(message.responseId)
    if (group) group.push(message)
    else groups.set(message.responseId, [message])
  }
  return new Map(
    [...groups].map(([id, group]) => [id, Object.freeze([...group])]),
  )
}

function validateSequence(
  incoming: readonly DurableMessage[],
  base: ValidatedState = {
    messages: Object.freeze([]),
    envelopeIds: new Set<EnvelopeId>(),
    toolUses: new Map<ToolUseId, ToolUseState>(),
  },
): ValidatedState {
  const messages = [...base.messages]
  const envelopeIds = new Set(base.envelopeIds)
  const toolUses = new Map(base.toolUses)

  for (const rawMessage of incoming) {
    const message = cloneMessage(rawMessage)
    requireNonEmpty(message.id, 'message envelope id')
    if (envelopeIds.has(message.id)) {
      throw new MessageInvariantError(`duplicate envelope id: ${message.id}`)
    }
    if (message.parentId !== undefined && !envelopeIds.has(message.parentId)) {
      throw new MessageInvariantError(
        `unknown parent envelope id: ${message.parentId}`,
      )
    }

    if (message.kind === 'human' || message.kind === 'system') {
      requireNonEmpty(message.text, `${message.kind} text`)
    } else if (message.kind === 'assistant') {
      requireNonEmpty(message.responseId, 'assistant response id')
      if (message.blocks.length === 0) {
        throw new MessageInvariantError('assistant blocks must not be empty')
      }
      for (const block of message.blocks) {
        if (block.kind !== 'tool-use') continue
        if (toolUses.has(block.id)) {
          throw new MessageInvariantError(`duplicate tool use id: ${block.id}`)
        }
        toolUses.set(block.id, 'pending')
      }
    } else {
      const state = toolUses.get(message.toolUseId)
      if (state === undefined) {
        throw new MessageInvariantError(
          `tool result has no matching tool use: ${message.toolUseId}`,
        )
      }
      if (state === 'resolved') {
        throw new MessageInvariantError(
          `duplicate tool result: ${message.toolUseId}`,
        )
      }
      toolUses.set(message.toolUseId, 'resolved')
    }

    envelopeIds.add(message.id)
    messages.push(message)
  }

  return Object.freeze({
    messages: Object.freeze(messages),
    envelopeIds,
    toolUses,
  })
}

function cloneMessage(message: DurableMessage): DurableMessage {
  return deepFreeze(cloneData(message))
}

function cloneData<T>(value: T): T {
  try {
    return structuredClone(value)
  } catch (error) {
    throw new MessageInvariantError(
      `message must contain cloneable data: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested)
    }
    Object.freeze(value)
  }
  return value
}

function brand(value: string, name: string): string {
  requireNonEmpty(value, name)
  return value
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim() === '') {
    throw new MessageInvariantError(`${name} must not be empty`)
  }
}
