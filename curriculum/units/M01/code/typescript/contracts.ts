export type MessageId = string

type MessageBase = {
  id: MessageId
  timestamp: string
}

export type UserMessage = MessageBase & {
  kind: 'user'
  content: string
}

export type TextBlock = {
  type: 'text'
  text: string
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export type AssistantMessage = MessageBase & {
  kind: 'assistant'
  blocks: Array<TextBlock | ToolUseBlock>
}

export type ProgressMessage = MessageBase & {
  kind: 'progress'
  toolUseId: string
  completed: number
}

export type SystemMessage = MessageBase & {
  kind: 'system'
  level: 'info' | 'warning' | 'error'
  content: string
}

export type HarnessMessage =
  | UserMessage
  | AssistantMessage
  | ProgressMessage
  | SystemMessage

export function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`)
}

export function summarizeMessage(message: HarnessMessage): string {
  switch (message.kind) {
    case 'user':
      return `user:${message.content}`
    case 'assistant':
      return `assistant:${message.blocks.length}`
    case 'progress':
      return `progress:${message.toolUseId}:${message.completed}`
    case 'system':
      return `system:${message.level}:${message.content}`
    default:
      return assertNever(message)
  }
}

export type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; turn: number }
  | { kind: 'completed'; finalMessageId: string }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled'; reason: string }

const ALLOWED_TRANSITIONS: Record<RunState['kind'], ReadonlySet<RunState['kind']>> = {
  idle: new Set(['running']),
  running: new Set(['running', 'completed', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

export function transitionRunState(current: RunState, next: RunState): RunState {
  if (!ALLOWED_TRANSITIONS[current.kind].has(next.kind)) {
    throw new Error(`Illegal transition: ${current.kind} -> ${next.kind}`)
  }
  return next
}

export type Validator<T> = (value: unknown) => value is T

export interface Tool<Input, Output> {
  readonly name: string
  readonly validateInput: Validator<Input>
  execute(input: Input): Promise<Output>
}

export async function executeTool<Input, Output>(
  tool: Tool<Input, Output>,
  rawInput: unknown,
): Promise<Output> {
  if (!tool.validateInput(rawInput)) {
    throw new Error(`Invalid input for tool ${tool.name}`)
  }
  return tool.execute(rawInput)
}

export function executeTypedTool<Input, Output>(
  tool: Tool<Input, Output>,
  input: NoInfer<Input>,
): Promise<Output> {
  return tool.execute(input)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasBase(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string' && typeof value.timestamp === 'string'
}

export function parseMessage(value: unknown): HarnessMessage {
  if (!isRecord(value) || !hasBase(value)) {
    throw new Error('Message base fields are invalid')
  }

  switch (value.kind) {
    case 'user':
      if (typeof value.content === 'string') return value as UserMessage
      break
    case 'progress':
      if (
        typeof value.toolUseId === 'string' &&
        typeof value.completed === 'number'
      ) {
        return value as ProgressMessage
      }
      break
    case 'system':
      if (
        (value.level === 'info' ||
          value.level === 'warning' ||
          value.level === 'error') &&
        typeof value.content === 'string'
      ) {
        return value as SystemMessage
      }
      break
    case 'assistant':
      if (Array.isArray(value.blocks)) return value as AssistantMessage
      break
  }

  throw new Error(`Invalid message variant: ${String(value.kind)}`)
}

export type WeatherInput = { city: string }
export type WeatherOutput = { city: string; temperatureC: number }

export const weatherTool: Tool<WeatherInput, WeatherOutput> = {
  name: 'weather',
  validateInput(value: unknown): value is WeatherInput {
    return isRecord(value) && typeof value.city === 'string'
  },
  async execute(input) {
    return { city: input.city, temperatureC: 31 }
  },
}
