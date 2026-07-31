export type McpServerCapabilities = Readonly<{
  tools: boolean
  resources: boolean
  prompts: boolean
}>

export type McpHandshake = Readonly<{
  serverName: string
  serverVersion: string
  capabilities: McpServerCapabilities
  instructions?: string
}>

export type McpRemoteTool = Readonly<{
  name: string
  description: string
  inputSchema: Readonly<Record<string, unknown>>
  annotations?: Readonly<Record<string, unknown>>
}>

export type McpCallResult = Readonly<{
  content: unknown
  isError?: boolean
}>

export type McpTransportNotification = 'tools/list_changed'

export interface McpTransport {
  connect(signal: AbortSignal): Promise<McpHandshake>
  listTools(signal: AbortSignal): Promise<readonly McpRemoteTool[]>
  callTool(
    toolName: string,
    args: Readonly<Record<string, unknown>>,
    options: Readonly<{ signal: AbortSignal; idempotencyKey: string; timeoutMs: number }>,
  ): Promise<McpCallResult>
  close(reason: string): Promise<void>
}

export type McpTransportFactory = () => McpTransport

export type McpSessionState =
  | Readonly<{ type: 'idle'; generation: number }>
  | Readonly<{ type: 'connecting'; generation: number }>
  | Readonly<{ type: 'ready'; generation: number; revision: number }>
  | Readonly<{ type: 'degraded'; generation: number; revision: number; reason: string }>
  | Readonly<{ type: 'closed'; generation: number }>

export type McpCapabilitySnapshot = Readonly<{
  serverName: string
  generation: number
  revision: number
  capabilities: McpServerCapabilities
  tools: readonly Readonly<{
    qualifiedName: string
    remoteName: string
    description: string
    inputSchema: Readonly<Record<string, unknown>>
  }>[]
}>

export type McpSessionTrace = Readonly<{
  action: 'connect' | 'refresh' | 'degrade' | 'disconnect' | 'call' | 'retry'
  generation: number
  revision: number
  toolCount: number
}>

export interface McpRetryPolicy {
  allowSessionRecovery(tool: McpRemoteTool): boolean
}

export class NoMcpRetryPolicy implements McpRetryPolicy {
  allowSessionRecovery(): boolean { return false }
}

export class McpSessionExpiredError extends Error {}
export class StaleMcpSnapshotError extends Error {}
export class IndeterminateMcpOutcomeError extends Error {}

export class McpSession {
  #state: McpSessionState = Object.freeze({ type: 'idle', generation: 0 })
  #revision = 0
  #transport?: McpTransport
  #handshake?: McpHandshake
  #tools: readonly McpRemoteTool[] = Object.freeze([])
  readonly #factory: McpTransportFactory
  readonly #retryPolicy: McpRetryPolicy
  readonly #timeoutMs: number
  readonly #trace: McpSessionTrace[] = []

  constructor(
    factory: McpTransportFactory,
    options: Readonly<{ retryPolicy?: McpRetryPolicy; timeoutMs?: number }> = {},
  ) {
    this.#factory = factory
    this.#retryPolicy = options.retryPolicy ?? new NoMcpRetryPolicy()
    this.#timeoutMs = options.timeoutMs ?? 60_000
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new Error('MCP timeout must be a positive integer')
    }
  }

  state(): McpSessionState { return deepFreeze(structuredClone(this.#state)) }

  async connect(signal: AbortSignal): Promise<McpCapabilitySnapshot> {
    throwIfAborted(signal)
    if (this.#state.type === 'closed') throw new Error('MCP session is closed')
    const generation = this.#state.generation + 1
    this.#state = Object.freeze({ type: 'connecting', generation })
    const candidate = this.#factory()
    try {
      const handshake = validateHandshake(await candidate.connect(signal))
      throwIfAborted(signal)
      const tools = handshake.capabilities.tools
        ? validateTools(await candidate.listTools(signal))
        : Object.freeze([])
      throwIfAborted(signal)
      await this.#transport?.close('replaced by newer MCP generation')
      this.#transport = candidate
      this.#handshake = handshake
      this.#tools = tools
      this.#revision += 1
      this.#state = Object.freeze({ type: 'ready', generation, revision: this.#revision })
      this.#record('connect')
      return this.snapshot()
    } catch (error) {
      await candidate.close('MCP initialization failed').catch(() => {})
      this.#state = Object.freeze({
        type: 'degraded', generation, revision: this.#revision, reason: safeCategory(error),
      })
      this.#record('degrade')
      throw error
    }
  }

  snapshot(): McpCapabilitySnapshot {
    if (this.#state.type !== 'ready' || !this.#handshake) {
      throw new Error('MCP session is not ready')
    }
    return deepFreeze({
      serverName: this.#handshake.serverName,
      generation: this.#state.generation,
      revision: this.#revision,
      capabilities: this.#handshake.capabilities,
      tools: this.#tools.map(tool => ({
        qualifiedName: qualify(this.#handshake!.serverName, tool.name),
        remoteName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    })
  }

  async handleNotification(
    notification: McpTransportNotification,
    signal: AbortSignal,
  ): Promise<McpCapabilitySnapshot> {
    if (notification !== 'tools/list_changed') throw new Error('unsupported MCP notification')
    if (this.#state.type !== 'ready' || !this.#transport) {
      throw new Error('MCP session is not ready')
    }
    try {
      const tools = validateTools(await this.#transport.listTools(signal))
      throwIfAborted(signal)
      this.#tools = tools
      this.#revision += 1
      this.#state = Object.freeze({
        type: 'ready', generation: this.#state.generation, revision: this.#revision,
      })
      this.#record('refresh')
      return this.snapshot()
    } catch (error) {
      this.#state = Object.freeze({
        type: 'degraded', generation: this.#state.generation,
        revision: this.#revision, reason: safeCategory(error),
      })
      this.#record('degrade')
      throw error
    }
  }

  async call(
    snapshot: McpCapabilitySnapshot,
    qualifiedName: string,
    args: Readonly<Record<string, unknown>>,
    callId: string,
    signal: AbortSignal,
  ): Promise<McpCallResult> {
    const tool = this.#assertCallable(snapshot, qualifiedName)
    const idempotencyKey = `${snapshot.serverName}:${snapshot.generation}:${callId}`
    try {
      const result = await this.#transport!.callTool(tool.name, structuredClone(args), {
        signal, idempotencyKey, timeoutMs: this.#timeoutMs,
      })
      this.#record('call')
      return deepFreeze(structuredClone(result))
    } catch (error) {
      if (!(error instanceof McpSessionExpiredError)) throw error
      if (!this.#retryPolicy.allowSessionRecovery(tool)) {
        throw new IndeterminateMcpOutcomeError(
          `MCP call outcome is indeterminate and retry is not approved: ${qualifiedName}`,
        )
      }
      const recovered = await this.connect(signal)
      const recoveredTool = this.#tools.find(item =>
        qualify(recovered.serverName, item.name) === qualifiedName,
      )
      if (!recoveredTool || stableSchema(recoveredTool.inputSchema) !== stableSchema(tool.inputSchema)) {
        throw new IndeterminateMcpOutcomeError('MCP tool changed during session recovery')
      }
      this.#record('retry')
      return deepFreeze(structuredClone(await this.#transport!.callTool(
        recoveredTool.name, structuredClone(args),
        { signal, idempotencyKey, timeoutMs: this.#timeoutMs },
      )))
    }
  }

  async disconnect(reason = 'MCP disconnect'): Promise<void> {
    await this.#transport?.close(reason)
    this.#transport = undefined
    this.#handshake = undefined
    this.#tools = Object.freeze([])
    this.#state = Object.freeze({ type: 'idle', generation: this.#state.generation })
    this.#record('disconnect')
  }

  async close(): Promise<void> {
    await this.#transport?.close('MCP session closed')
    this.#transport = undefined
    this.#handshake = undefined
    this.#tools = Object.freeze([])
    this.#state = Object.freeze({ type: 'closed', generation: this.#state.generation })
  }

  traces(): readonly McpSessionTrace[] { return deepFreeze(this.#trace.map(item => ({ ...item }))) }

  #assertCallable(snapshot: McpCapabilitySnapshot, qualifiedName: string): McpRemoteTool {
    if (this.#state.type !== 'ready' || !this.#transport || !this.#handshake) {
      throw new Error('MCP session is not ready')
    }
    if (snapshot.generation !== this.#state.generation || snapshot.revision !== this.#revision) {
      throw new StaleMcpSnapshotError('MCP capability snapshot is stale')
    }
    const descriptor = snapshot.tools.find(item => item.qualifiedName === qualifiedName)
    if (!descriptor) throw new Error(`MCP tool is not visible: ${qualifiedName}`)
    const tool = this.#tools.find(item => item.name === descriptor.remoteName)
    if (!tool) throw new Error(`MCP tool has no remote handler: ${qualifiedName}`)
    return tool
  }

  #record(action: McpSessionTrace['action']): void {
    this.#trace.push(Object.freeze({
      action, generation: this.#state.generation, revision: this.#revision,
      toolCount: this.#tools.length,
    }))
  }
}

function validateHandshake(value: McpHandshake): McpHandshake {
  requireText(value.serverName, 'MCP server name')
  requireText(value.serverVersion, 'MCP server version')
  return deepFreeze(structuredClone(value))
}

function validateTools(tools: readonly McpRemoteTool[]): readonly McpRemoteTool[] {
  const names = new Set<string>()
  return deepFreeze(tools.map(tool => {
    requireText(tool.name, 'MCP tool name')
    requireText(tool.description, 'MCP tool description')
    if (names.has(tool.name)) throw new Error(`duplicate MCP tool: ${tool.name}`)
    names.add(tool.name)
    if (tool.inputSchema.type !== undefined && tool.inputSchema.type !== 'object') {
      throw new Error(`MCP tool schema must describe an object: ${tool.name}`)
    }
    return structuredClone(tool)
  }))
}

function qualify(serverName: string, toolName: string): string {
  return `mcp__${normalize(serverName)}__${normalize(toolName)}`
}

function normalize(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_')
}

function stableSchema(value: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value, Object.keys(value).sort())
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

function safeCategory(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty`)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
