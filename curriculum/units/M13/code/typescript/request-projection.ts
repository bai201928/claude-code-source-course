export type DomainMessage =
  | Readonly<{ kind: 'compact-boundary'; id: string }>
  | Readonly<{ kind: 'progress'; id: string; detail: string }>
  | Readonly<{ kind: 'user-context'; id: string; text: string }>
  | Readonly<{ kind: 'human'; id: string; text: string }>
  | Readonly<{ kind: 'local-output'; id: string; text: string }>
  | Readonly<{ kind: 'attachment'; id: string; text: string }>
  | Readonly<{ kind: 'assistant'; id: string; responseId: string; blocks: readonly AssistantBlock[] }>
  | Readonly<{ kind: 'tool-result'; id: string; toolUseId: string; output: string; isError?: boolean }>

export type AssistantBlock =
  | Readonly<{ kind: 'text'; text: string }>
  | Readonly<{ kind: 'tool-use'; id: string; name: string; input: Readonly<Record<string, unknown>> }>

export type ApiBlock =
  | Readonly<{ type: 'text'; text: string }>
  | Readonly<{ type: 'tool_use'; id: string; name: string; input: Readonly<Record<string, unknown>> }>
  | Readonly<{ type: 'tool_result'; tool_use_id: string; content: string; is_error: boolean }>

export type ApiMessage = Readonly<{
  role: 'user' | 'assistant'
  content: readonly ApiBlock[]
}>

export type ProjectionOptions = Readonly<{
  userContext?: string
  toolResultBudgetChars?: number
  pairing?: 'strict' | 'repair'
  replacementState?: ContentReplacementState
}>

export type ContentReplacementState = {
  seenIds: Set<string>
  replacements: Map<string, string>
}

export type ProjectionReport = Readonly<{
  sourceCount: number
  selectedCount: number
  apiCount: number
  omittedBeforeBoundary: number
  replacedToolUseIds: readonly string[]
  repairedMissingToolUseIds: readonly string[]
  removedOrphanToolUseIds: readonly string[]
  userContextInjected: boolean
}>

export type ProjectedRequest = Readonly<{
  messages: readonly ApiMessage[]
  report: ProjectionReport
}>

export type FinalRequestParams = Readonly<{
  model: string
  messages: readonly ApiMessage[]
  tools: readonly Readonly<{ name: string; input_schema: Readonly<Record<string, unknown>> }>[]
  max_tokens: number
  stream: true
}>

export class ProjectionError extends Error {}

export function createContentReplacementState(): ContentReplacementState {
  return { seenIds: new Set(), replacements: new Map() }
}

export function projectRequest(
  source: readonly DomainMessage[],
  options: ProjectionOptions = {},
): ProjectedRequest {
  const sourceClone = structuredClone(source)
  const boundary = findLastIndex(source, message => message.kind === 'compact-boundary')
  const selected = source.slice(boundary < 0 ? 0 : boundary)
  const replacementState = options.replacementState ?? createContentReplacementState()
  const budgeted = applyToolResultBudget(
    selected,
    options.toolResultBudgetChars ?? Number.POSITIVE_INFINITY,
    replacementState,
  )
  const userContext = options.userContext?.trim()
  const queryView: readonly DomainMessage[] = userContext
    ? [
        {
          kind: 'user-context',
          id: 'request-user-context',
          text: `<system-reminder>\n${userContext}\n</system-reminder>`,
        },
        ...budgeted.messages,
      ]
    : budgeted.messages
  let messages = normalize(queryView)
  const pairing = ensurePairing(messages, options.pairing ?? 'strict')
  messages = pairing.messages

  if (JSON.stringify(source) !== JSON.stringify(sourceClone)) {
    throw new ProjectionError('projection mutated its durable source')
  }

  return deepFreeze({
    messages,
    report: {
      sourceCount: source.length,
      selectedCount: selected.length,
      apiCount: messages.length,
      omittedBeforeBoundary: boundary < 0 ? 0 : boundary,
      replacedToolUseIds: budgeted.replacedToolUseIds,
      repairedMissingToolUseIds: pairing.repairedMissingToolUseIds,
      removedOrphanToolUseIds: pairing.removedOrphanToolUseIds,
      userContextInjected: Boolean(userContext),
    },
  })
}

export function buildFinalParams(
  model: string,
  projection: ProjectedRequest,
  tools: readonly Readonly<{ name: string; input_schema: Readonly<Record<string, unknown>> }>[],
  maxTokens: number,
): FinalRequestParams {
  if (!model.trim()) throw new ProjectionError('model must not be empty')
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new ProjectionError('maxTokens must be a positive integer')
  }
  return deepFreeze({
    model,
    messages: structuredClone(projection.messages),
    tools: structuredClone(tools),
    max_tokens: maxTokens,
    stream: true as const,
  })
}

function applyToolResultBudget(
  messages: readonly DomainMessage[],
  budget: number,
  state: ContentReplacementState,
): { messages: readonly DomainMessage[]; replacedToolUseIds: readonly string[] } {
  if (budget === Number.POSITIVE_INFINITY && state.replacements.size === 0) {
    for (const group of collectCandidatesByApiUserGroup(messages)) {
      for (const message of group) state.seenIds.add(message.toolUseId)
    }
    return { messages, replacedToolUseIds: [] }
  }
  if (!Number.isInteger(budget) || budget < 1) {
    if (budget !== Number.POSITIVE_INFINITY) {
      throw new ProjectionError('toolResultBudgetChars must be a positive integer')
    }
  }
  const replacements = new Map<string, string>()
  for (const group of collectCandidatesByApiUserGroup(messages)) {
    const fresh = group.filter(message => !state.seenIds.has(message.toolUseId))
    const frozenSize = group
      .filter(message => state.seenIds.has(message.toolUseId) && !state.replacements.has(message.toolUseId))
      .reduce((sum, message) => sum + message.output.length, 0)
    for (const message of group) {
      const prior = state.replacements.get(message.toolUseId)
      if (prior !== undefined) replacements.set(message.toolUseId, prior)
    }

    let remaining = frozenSize + fresh.reduce((sum, message) => sum + message.output.length, 0)
    for (const message of [...fresh].sort(
      (a, b) => b.output.length - a.output.length || a.toolUseId.localeCompare(b.toolUseId),
    )) {
      if (remaining <= budget) break
      const prefix = message.output.slice(0, Math.min(24, budget))
      const preview = `[tool result ${message.toolUseId} omitted: ${message.output.length} chars; prefix=${JSON.stringify(prefix)}]`
      replacements.set(message.toolUseId, preview)
      state.replacements.set(message.toolUseId, preview)
      remaining -= message.output.length
    }
    for (const message of fresh) state.seenIds.add(message.toolUseId)
  }

  return {
    messages: messages.map(message =>
      message.kind === 'tool-result' && replacements.has(message.toolUseId)
        ? Object.freeze({ ...message, output: replacements.get(message.toolUseId)! })
        : message,
    ),
    replacedToolUseIds: Object.freeze([...replacements.keys()]),
  }
}

function collectCandidatesByApiUserGroup(
  messages: readonly DomainMessage[],
): Extract<DomainMessage, { kind: 'tool-result' }>[][] {
  const groups: Extract<DomainMessage, { kind: 'tool-result' }>[][] = []
  const seenAssistantResponses = new Set<string>()
  let current: Extract<DomainMessage, { kind: 'tool-result' }>[] = []
  const flush = () => {
    if (current.length > 0) groups.push(current)
    current = []
  }
  for (const message of messages) {
    if (message.kind === 'tool-result') current.push(message)
    if (message.kind === 'assistant' && !seenAssistantResponses.has(message.responseId)) {
      flush()
      seenAssistantResponses.add(message.responseId)
    }
  }
  flush()
  return groups
}

function normalize(messages: readonly DomainMessage[]): ApiMessage[] {
  const result: ApiMessage[] = []
  for (const message of messages) {
    switch (message.kind) {
      case 'compact-boundary':
      case 'progress':
        continue
      case 'user-context':
      case 'human':
      case 'local-output':
      case 'attachment':
        pushUser(result, [{ type: 'text', text: message.text }])
        continue
      case 'tool-result':
        pushUser(result, [{
          type: 'tool_result',
          tool_use_id: message.toolUseId,
          content: message.output,
          is_error: message.isError ?? false,
        }])
        continue
      case 'assistant': {
        const blocks: ApiBlock[] = message.blocks.map(block =>
          block.kind === 'text'
            ? { type: 'text', text: block.text }
            : { type: 'tool_use', id: block.id, name: block.name, input: structuredClone(block.input) },
        )
        const previous = result.at(-1)
        if (previous?.role === 'assistant') {
          result[result.length - 1] = deepFreeze({
            role: 'assistant' as const,
            content: [...previous.content, ...blocks],
          })
        } else {
          result.push(deepFreeze({ role: 'assistant' as const, content: blocks }))
        }
        continue
      }
      default:
        return assertNever(message)
    }
  }
  return result
}

function ensurePairing(
  messages: readonly ApiMessage[],
  mode: 'strict' | 'repair',
): {
  messages: ApiMessage[]
  repairedMissingToolUseIds: readonly string[]
  removedOrphanToolUseIds: readonly string[]
} {
  const result: ApiMessage[] = []
  const repaired: string[] = []
  const removed: string[] = []
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!
    if (message.role !== 'assistant') {
      const orphanIds = message.content
        .filter((block): block is Extract<ApiBlock, { type: 'tool_result' }> => block.type === 'tool_result')
        .map(block => block.tool_use_id)
      if (orphanIds.length > 0) {
        if (mode === 'strict') throw new ProjectionError(`orphan tool results: ${orphanIds.join(',')}`)
        removed.push(...orphanIds)
        const kept = message.content.filter(block => block.type !== 'tool_result')
        if (kept.length > 0) result.push(apiUser(kept))
        continue
      }
      result.push(message)
      continue
    }

    result.push(message)
    const useIds = message.content
      .filter((block): block is Extract<ApiBlock, { type: 'tool_use' }> => block.type === 'tool_use')
      .map(block => block.id)
    if (new Set(useIds).size !== useIds.length) {
      throw new ProjectionError('duplicate tool use id')
    }
    if (useIds.length === 0) continue

    const next = messages[index + 1]
    const resultBlocks = next?.role === 'user'
      ? next.content.filter((block): block is Extract<ApiBlock, { type: 'tool_result' }> => block.type === 'tool_result')
      : []
    const seen = new Set<string>()
    for (const block of resultBlocks) {
      if (seen.has(block.tool_use_id)) throw new ProjectionError(`duplicate tool result: ${block.tool_use_id}`)
      seen.add(block.tool_use_id)
    }
    const missing = useIds.filter(id => !seen.has(id))
    const orphan = resultBlocks.map(block => block.tool_use_id).filter(id => !useIds.includes(id))
    if (missing.length === 0 && orphan.length === 0) {
      if (next?.role === 'user') {
        result.push(next)
        index += 1
      }
      continue
    }
    if (mode === 'strict') {
      throw new ProjectionError(`tool pairing mismatch: missing=${missing.join(',')} orphan=${orphan.join(',')}`)
    }

    repaired.push(...missing)
    removed.push(...orphan)
    const kept = next?.role === 'user'
      ? next.content.filter(block => block.type !== 'tool_result' || useIds.includes(block.tool_use_id))
      : []
    const synthetics: ApiBlock[] = missing.map(id => ({
      type: 'tool_result',
      tool_use_id: id,
      content: '[missing tool result repaired]',
      is_error: true,
    }))
    const patched = apiUser([...synthetics, ...kept])
    if (next?.role === 'user') index += 1
    result.push(patched)
  }
  return {
    messages: result,
    repairedMissingToolUseIds: Object.freeze(repaired),
    removedOrphanToolUseIds: Object.freeze(removed),
  }
}

function pushUser(target: ApiMessage[], blocks: readonly ApiBlock[]): void {
  const previous = target.at(-1)
  if (previous?.role === 'user') {
    const all = [...previous.content, ...blocks]
    const toolResults = all.filter(block => block.type === 'tool_result')
    const others = all.filter(block => block.type !== 'tool_result')
    target[target.length - 1] = apiUser([...toolResults, ...others])
  } else {
    target.push(apiUser(blocks))
  }
}

function mergeAdjacentUsers(messages: readonly ApiMessage[]): ApiMessage[] {
  const result: ApiMessage[] = []
  for (const message of messages) {
    if (message.role === 'user') pushUser(result, message.content)
    else result.push(message)
  }
  return result
}

function apiUser(content: readonly ApiBlock[]): ApiMessage {
  return deepFreeze({ role: 'user' as const, content: [...content] })
}

function findLastIndex<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index--) {
    if (predicate(values[index]!)) return index
  }
  return -1
}

function assertNever(value: never): never {
  throw new ProjectionError(`unknown message: ${JSON.stringify(value)}`)
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.isFrozen(value) ? value : Object.freeze(value)
}
