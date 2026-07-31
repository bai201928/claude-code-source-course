import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IndeterminateMcpOutcomeError,
  McpSession,
  McpSessionExpiredError,
  StaleMcpSnapshotError,
  type McpCallResult,
  type McpHandshake,
  type McpRemoteTool,
  type McpRetryPolicy,
  type McpTransport,
} from './mcpSession.ts'

const signal = () => new AbortController().signal
const readTool: McpRemoteTool = {
  name: 'read', description: 'Read remotely', inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
}

test('connect negotiates capabilities and publishes a qualified immutable snapshot', async () => {
  const transport = new FakeTransport([readTool])
  const session = new McpSession(() => transport)
  const snapshot = await session.connect(signal())
  assert.equal(snapshot.generation, 1)
  assert.equal(snapshot.revision, 1)
  assert.deepEqual(snapshot.tools.map(item => item.qualifiedName), ['mcp__demo_server__read'])
  assert.equal(Object.isFrozen(snapshot.tools), true)
})

test('tool-list failure fails initialization without publishing partial capability state', async () => {
  const transport = new FakeTransport([readTool])
  transport.listError = new Error('remote-list-secret')
  const session = new McpSession(() => transport)
  await assert.rejects(session.connect(signal()), /remote-list-secret/)
  assert.equal(session.state().type, 'degraded')
  assert.throws(() => session.snapshot(), /not ready/)
  assert.equal(transport.closed, true)
})

test('list-changed publishes a new revision and stale request snapshots fail closed', async () => {
  const transport = new FakeTransport([readTool])
  const session = new McpSession(() => transport)
  const old = await session.connect(signal())
  transport.tools = [{ ...readTool, name: 'search' }]
  const fresh = await session.handleNotification('tools/list_changed', signal())
  assert.equal(fresh.revision, 2)
  assert.deepEqual(old.tools.map(item => item.remoteName), ['read'])
  await assert.rejects(
    session.call(old, 'mcp__demo_server__read', {}, 'call-1', signal()),
    StaleMcpSnapshotError,
  )
})

test('refresh failure degrades the session instead of serving stale tools to new calls', async () => {
  const transport = new FakeTransport([readTool])
  const session = new McpSession(() => transport)
  const snapshot = await session.connect(signal())
  transport.listError = new Error('refresh failed')
  await assert.rejects(session.handleNotification('tools/list_changed', signal()))
  await assert.rejects(
    session.call(snapshot, 'mcp__demo_server__read', {}, 'call-1', signal()),
    /not ready/,
  )
})

test('disconnect makes the previous generation unavailable', async () => {
  const transport = new FakeTransport([readTool])
  const session = new McpSession(() => transport)
  const snapshot = await session.connect(signal())
  await session.disconnect()
  await assert.rejects(
    session.call(snapshot, 'mcp__demo_server__read', {}, 'call-1', signal()),
    /not ready/,
  )
})

test('session expiry is indeterminate when local retry policy does not approve replay', async () => {
  const transport = new FakeTransport([readTool])
  transport.callError = new McpSessionExpiredError('expired')
  const session = new McpSession(() => transport)
  const snapshot = await session.connect(signal())
  await assert.rejects(
    session.call(snapshot, 'mcp__demo_server__read', {}, 'call-1', signal()),
    IndeterminateMcpOutcomeError,
  )
  assert.equal(transport.calls.length, 1)
})

test('approved recovery retries once with the same idempotency key', async () => {
  const first = new FakeTransport([readTool])
  first.callError = new McpSessionExpiredError('expired')
  const second = new FakeTransport([readTool])
  const transports = [first, second]
  const retryPolicy: McpRetryPolicy = { allowSessionRecovery: () => true }
  const session = new McpSession(() => transports.shift()!, { retryPolicy })
  const snapshot = await session.connect(signal())
  const result = await session.call(snapshot, 'mcp__demo_server__read', {}, 'call-1', signal())
  assert.deepEqual(result, { content: 'ok' })
  assert.equal(first.calls[0]?.idempotencyKey, second.calls[0]?.idempotencyKey)
  assert.match(first.calls[0]!.idempotencyKey, /call-1$/)
})

test('abort is propagated to the adapter without claiming remote rollback', async () => {
  const transport = new FakeTransport([readTool])
  const session = new McpSession(() => transport)
  const snapshot = await session.connect(signal())
  const controller = new AbortController()
  controller.abort(new DOMException('stop waiting', 'AbortError'))
  transport.callImpl = async (_name, _args, options) => {
    assert.equal(options.signal.aborted, true)
    throw options.signal.reason
  }
  await assert.rejects(
    session.call(snapshot, 'mcp__demo_server__read', {}, 'call-1', controller.signal),
    /stop waiting/,
  )
})

test('trace contains lifecycle metadata but no remote content or arguments', async () => {
  const transport = new FakeTransport([readTool])
  const session = new McpSession(() => transport)
  const snapshot = await session.connect(signal())
  await session.call(snapshot, 'mcp__demo_server__read', { secret: 'do-not-log' }, 'call-1', signal())
  const trace = JSON.stringify(session.traces())
  assert.equal(trace.includes('do-not-log'), false)
  assert.equal(trace.includes('Read remotely'), false)
})

class FakeTransport implements McpTransport {
  tools: readonly McpRemoteTool[]
  listError?: Error
  callError?: Error
  closed = false
  calls: { name: string; idempotencyKey: string }[] = []
  callImpl?: McpTransport['callTool']

  constructor(tools: readonly McpRemoteTool[]) { this.tools = tools }

  async connect(_signal: AbortSignal): Promise<McpHandshake> {
    return {
      serverName: 'demo server', serverVersion: '1.0.0',
      capabilities: { tools: true, resources: false, prompts: false },
    }
  }

  async listTools(_signal: AbortSignal): Promise<readonly McpRemoteTool[]> {
    if (this.listError) throw this.listError
    return this.tools
  }

  async callTool(
    name: string,
    args: Readonly<Record<string, unknown>>,
    options: Readonly<{ signal: AbortSignal; idempotencyKey: string; timeoutMs: number }>,
  ): Promise<McpCallResult> {
    this.calls.push({ name, idempotencyKey: options.idempotencyKey })
    if (this.callImpl) return this.callImpl(name, args, options)
    if (this.callError) throw this.callError
    return { content: 'ok' }
  }

  async close(_reason: string): Promise<void> { this.closed = true }
}
