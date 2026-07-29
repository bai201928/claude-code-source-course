import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityCatalog, CapabilityProjector } from '../capabilityProjection.ts'
import {
  ConversationStore,
  envelopeId,
  responseId,
  toolUseBlock,
  toolUseId,
} from '../conversationStore.ts'
import {
  createRequestContext,
  createRuntimeContext,
  createSessionStateStore,
  type SessionStateStore,
} from '../runtimeContext.ts'
import { PolicyPermissionGate, type PermissionGate } from './permissions.ts'
import {
  RequestProjector,
  type RequestProjectionPolicy,
} from './requestProjector.ts'
import {
  AgentRuntime,
  MonotonicIdSource,
  type AgentEvent,
  type AgentEventSink,
} from './runtime.ts'
import { ScriptedModelAdapter } from './testing.ts'
import { MemoryTraceSink, TraceRecorder } from './trace.ts'
import { AgentToolRegistry, type AgentTool } from './tools.ts'

test('runs a two-request tool loop through the revisioned ConversationStore', async () => {
  const addTool = tool('add', 'read', async input => Number(input.left) + Number(input.right))
  const model = new ScriptedModelAdapter([
    () => ({
      responseId: 'response-1',
      toolCalls: [{ id: 'call-1', name: 'add', input: { left: 20, right: 22 } }],
    }),
    request => {
      const result = request.messages.find(message => message.role === 'tool')
      assert.deepEqual(result, { role: 'tool', toolCallId: 'call-1', content: '42' })
      return { responseId: 'response-2', text: 'The answer is 42.', toolCalls: [] }
    },
  ])
  const fixture = createFixture(model, [addTool])

  const result = await fixture.runtime.submit('Calculate 20 + 22', new AbortController().signal)

  assert.equal(result.status, 'completed')
  assert.equal(result.turns, 2)
  assert.equal(result.finalText, 'The answer is 42.')
  assert.equal(model.requests.length, 2)
  fixture.store.assertRequestReady(fixture.store.snapshot())
  assert.equal(fixture.trace.events.some(event => event.type === 'request.projected'), true)
  assert.equal(
    fixture.trace.events.some(event => Object.hasOwn(event.attributes, 'input')),
    false,
  )
})

test('projects request-only context and bounded tool previews without changing durable history', async () => {
  const fullOutput = 'sensitive-result-'.repeat(20)
  const inspect = tool('inspect', 'read', async () => fullOutput)
  const model = new ScriptedModelAdapter([
    request => {
      assert.equal(JSON.stringify(request.messages).includes('workspace=demo'), true)
      return {
        responseId: 'response-1',
        toolCalls: [{ id: 'call-inspect', name: 'inspect', input: {} }],
      }
    },
    request => {
      const toolResult = request.messages.find(message => message.role === 'tool')
      assert.ok(toolResult?.role === 'tool')
      assert.equal(toolResult.content.includes('preview:'), true)
      assert.equal(toolResult.content.includes(fullOutput), false)
      return { responseId: 'response-2', text: 'done', toolCalls: [] }
    },
  ])
  const fixture = createFixture(
    model,
    [inspect],
    new PolicyPermissionGate(),
    4,
    {
      requestProjectionPolicy: {
        userContext: 'workspace=demo',
        maxToolResultChars: 32,
        toolResultPreviewChars: 8,
      },
    },
  )

  const result = await fixture.runtime.submit('inspect', new AbortController().signal)

  assert.equal(result.status, 'completed')
  const durableResult = fixture.store.snapshot().messages.find(
    message => message.kind === 'tool-result',
  )
  assert.equal(durableResult?.kind === 'tool-result' && durableResult.output, fullOutput)
  const projectionTraces = fixture.trace.events.filter(event => event.type === 'request.projected')
  assert.equal(projectionTraces.at(-1)?.attributes.replacedToolResultCount, 1)
  assert.equal(projectionTraces.at(-1)?.attributes.userContextInjected, true)
  assert.equal(JSON.stringify(projectionTraces).includes('workspace=demo'), false)
  assert.equal(JSON.stringify(projectionTraces).includes(fullOutput), false)
})

test('turns permission denial into a paired error result that the model can observe', async () => {
  const dangerous = tool(
    'danger',
    'execute',
    async () => 'should not run',
    () => ({ toolName: 'danger', risk: 'execute', command: 'danger' }),
  )
  const model = new ScriptedModelAdapter([
    () => ({
      responseId: 'response-1',
      toolCalls: [{ id: 'call-denied', name: 'danger', input: {} }],
    }),
    request => {
      const result = request.messages.find(message => message.role === 'tool')
      assert.equal(result?.role, 'tool')
      assert.match(result.content, /no unrestricted grant/)
      return { responseId: 'response-2', text: 'I will continue without it.', toolCalls: [] }
    },
  ])
  const fixture = createFixture(model, [dangerous], new PolicyPermissionGate())

  const result = await fixture.runtime.submit('Try the command', new AbortController().signal)

  assert.equal(result.status, 'completed')
  assert.equal(
    fixture.trace.events.some(event =>
      event.type === 'tool.finished' && event.attributes.status === 'denied'),
    true,
  )
  fixture.store.assertRequestReady(fixture.store.snapshot())
})

test('turns an unserializable tool output into a paired error result', async () => {
  const cyclic = tool('cyclic', 'read', async () => {
    const output: { self?: unknown } = {}
    output.self = output
    return output
  })
  const after = tool('after', 'read', async () => 'still-ran')
  const model = new ScriptedModelAdapter([
    () => ({
      responseId: 'response-cyclic',
      toolCalls: [
        { id: 'call-cyclic', name: 'cyclic', input: {} },
        { id: 'call-after', name: 'after', input: {} },
      ],
    }),
    request => {
      const results = request.messages.filter(message => message.role === 'tool')
      assert.equal(results.length, 2)
      assert.match(results[0]!.content, /circular/i)
      assert.equal(results[1]!.content, 'still-ran')
      return { responseId: 'response-recovered', text: 'recovered', toolCalls: [] }
    },
  ])
  const fixture = createFixture(model, [cyclic, after])

  const result = await fixture.runtime.submit(
    'Keep the tool protocol paired',
    new AbortController().signal,
  )

  assert.equal(result.status, 'completed')
  const toolResults = fixture.store.snapshot().messages
    .filter(message => message.kind === 'tool-result')
  assert.equal(toolResults.length, 2)
  assert.equal(toolResults[0]!.isError, true)
  assert.equal(toolResults[1]!.isError, false)
  fixture.store.assertRequestReady(fixture.store.snapshot())
})

test('pairs the current and remaining tool calls when cancellation arrives in a tool', async () => {
  const controller = new AbortController()
  const cancelling = tool('cancel', 'read', async () => {
    controller.abort('test cancellation')
    throw new Error('cancelled by test')
  })
  const never = tool('never', 'read', async () => 'must not execute')
  const model = new ScriptedModelAdapter([
    () => ({
      responseId: 'response-1',
      toolCalls: [
        { id: 'call-cancel', name: 'cancel', input: {} },
        { id: 'call-never', name: 'never', input: {} },
      ],
    }),
  ])
  const fixture = createFixture(model, [cancelling, never])

  const result = await fixture.runtime.submit('Cancel this run', controller.signal)

  assert.equal(result.status, 'cancelled')
  assert.equal(model.requests.length, 1)
  const messages = fixture.store.snapshot().messages
  assert.equal(messages.filter(message => message.kind === 'tool-result').length, 2)
  fixture.store.assertRequestReady(fixture.store.snapshot())
  assert.equal(
    fixture.trace.events.some(event =>
      event.type === 'tool.started' && event.attributes.toolName === 'never'),
    false,
  )
})

test('rejects a second submit while the conversation is single-flight', async () => {
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const model = new ScriptedModelAdapter([
    async () => {
      await blocked
      return { responseId: 'response-1', text: 'done', toolCalls: [] }
    },
  ])
  const fixture = createFixture(model, [])
  const first = fixture.runtime.submit('first', new AbortController().signal)

  await assert.rejects(
    fixture.runtime.submit('second', new AbortController().signal),
    /active run/,
  )
  release()
  assert.equal((await first).status, 'completed')
})

test('active run lease rejects external durable conversation writes', async () => {
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  const model = new ScriptedModelAdapter([
    async () => {
      entered()
      await blocked
      return { responseId: 'response-lease', text: 'done', toolCalls: [] }
    },
  ])
  const fixture = createFixture(model, [])
  const pending = fixture.runtime.submit('hold the run lease', new AbortController().signal)
  await started

  assert.throws(
    () => fixture.store.append(fixture.store.revision, [Object.freeze({
      kind: 'human' as const,
      id: envelopeId('external-message'),
      text: 'must not interleave',
    })]),
    /active AgentRuntime run lease/,
  )

  release()
  assert.equal((await pending).status, 'completed')
})

test('rejects a second AgentRuntime owner for the same ConversationStore', () => {
  const conversation = new ConversationStore()
  const first = new ScriptedModelAdapter([
    () => ({ responseId: 'response-first', text: 'done', toolCalls: [] }),
  ])
  const second = new ScriptedModelAdapter([
    () => ({ responseId: 'response-second', text: 'done', toolCalls: [] }),
  ])
  createFixture(first, [], new PolicyPermissionGate(), 4, { conversation })

  assert.throws(
    () => createFixture(second, [], new PolicyPermissionGate(), 4, { conversation }),
    /already bound to another AgentRuntime/,
  )
})

test('returns a failed summary while preserving already committed user input', async () => {
  const model = new ScriptedModelAdapter([
    () => { throw new Error('provider unavailable') },
  ])
  const fixture = createFixture(model, [])

  const result = await fixture.runtime.submit('keep this input', new AbortController().signal)

  assert.equal(result.status, 'failed')
  assert.equal(result.error, 'provider unavailable')
  assert.equal(fixture.store.snapshot().messages.some(message => message.kind === 'human'), true)
})

test('stops at max turns only after each tool call has a paired result', async () => {
  const echo = tool('echo', 'read', async () => 'ok')
  const script = (_request: unknown, index: number) => ({
    responseId: `response-${index}`,
    toolCalls: [{ id: `call-${index}`, name: 'echo', input: {} }],
  })
  const model = new ScriptedModelAdapter([script, script])
  const fixture = createFixture(model, [echo], new PolicyPermissionGate(), 2)

  const result = await fixture.runtime.submit('keep looping', new AbortController().signal)

  assert.equal(result.status, 'max-turns')
  assert.equal(result.turns, 2)
  assert.equal(model.requests.length, 2)
  fixture.store.assertRequestReady(fixture.store.snapshot())
})

test('isolates event sink failures at every protocol phase', async t => {
  const eventTypes: readonly AgentEvent['type'][] = [
    'run.started',
    'assistant.text',
    'tool.started',
    'tool.finished',
    'run.finished',
  ]

  for (const eventType of eventTypes) {
    await t.test(eventType, async () => {
      const echo = tool('echo', 'read', async () => 'ok')
      const model = new ScriptedModelAdapter([
        () => ({
          responseId: 'response-tool',
          toolCalls: [{ id: 'call-echo', name: 'echo', input: {} }],
        }),
        () => ({ responseId: 'response-final', text: 'done', toolCalls: [] }),
      ])
      const events: AgentEventSink = {
        async emit(event) {
          if (event.type === eventType) throw new Error(`sink failed at ${eventType}`)
        },
      }
      const fixture = createFixture(
        model,
        [echo],
        new PolicyPermissionGate(),
        4,
        { events },
      )

      const result = await fixture.runtime.submit(
        `exercise ${eventType}`,
        new AbortController().signal,
      )

      assert.equal(result.status, 'completed')
      fixture.store.assertRequestReady(fixture.store.snapshot())
      assert.equal(
        fixture.store.snapshot().messages.filter(message => message.kind === 'tool-result').length,
        1,
      )
      assert.equal(
        fixture.trace.events.some(event =>
          event.type === 'event-sink.failed' && event.attributes.eventType === eventType),
        true,
      )
    })
  }
})

test('cancels a never-resolving permission decision and pairs all tool calls', {
  timeout: 2_000,
}, async () => {
  const controller = new AbortController()
  let decisionStarted!: () => void
  const started = new Promise<void>(resolve => { decisionStarted = resolve })
  let observedSignal: AbortSignal | undefined
  const gate: PermissionGate = {
    decide(_request, signal) {
      observedSignal = signal
      decisionStarted()
      return new Promise<never>(() => {})
    },
  }
  const first = tool('first', 'read', async () => 'must not execute')
  const second = tool('second', 'read', async () => 'must not execute')
  const model = new ScriptedModelAdapter([
    () => ({
      responseId: 'response-permission',
      toolCalls: [
        { id: 'call-first', name: 'first', input: {} },
        { id: 'call-second', name: 'second', input: {} },
      ],
    }),
  ])
  const fixture = createFixture(model, [first, second], gate)
  const pending = fixture.runtime.submit('wait for permission', controller.signal)

  await started
  controller.abort(new Error('permission cancelled by test'))
  const result = await pending

  assert.equal(observedSignal, controller.signal)
  assert.equal(result.status, 'cancelled')
  const toolResults = fixture.store.snapshot().messages
    .filter(message => message.kind === 'tool-result')
  assert.equal(toolResults.length, 2)
  assert.match(toolResults[0]!.output, /permission cancelled by test/)
  assert.equal(toolResults[1]!.output, 'cancelled before execution')
  fixture.store.assertRequestReady(fixture.store.snapshot())
})

test('preserves existing SessionState values when publishing request metadata', async () => {
  const sessionState = createSessionStateStore({
    trust: 'trusted',
    cwd: 'C:/work',
    preferences: { concise: true },
  })
  const model = new ScriptedModelAdapter([
    () => ({ responseId: 'response-1', text: 'done', toolCalls: [] }),
  ])
  const fixture = createFixture(
    model,
    [],
    new PolicyPermissionGate(),
    4,
    { sessionState },
  )

  const result = await fixture.runtime.submit('preserve state', new AbortController().signal)

  assert.equal(result.status, 'completed')
  assert.deepEqual(sessionState.getState().values, {
    trust: 'trusted',
    cwd: 'C:/work',
    preferences: { concise: true },
    mode: 'headless',
    conversationRevision: 1,
    capabilityCatalogRevision: 1,
  })
})

test('deep-freezes nested model request data behind already-frozen message shells', () => {
  const store = new ConversationStore()
  const humanId = envelopeId('message-human')
  const assistantId = envelopeId('message-assistant')
  const callId = toolUseId('call-inspect')
  store.append(0, [Object.freeze({
    kind: 'human' as const,
    id: humanId,
    text: 'inspect nested data',
  })])
  store.append(1, [Object.freeze({
    kind: 'assistant' as const,
    id: assistantId,
    responseId: responseId('response-inspect'),
    parentId: humanId,
    blocks: Object.freeze([
      toolUseBlock(callId, 'inspect', {
        options: { limit: 3, tags: ['source'] },
      }),
    ]),
  })])
  store.append(2, [Object.freeze({
    kind: 'tool-result' as const,
    id: envelopeId('message-result'),
    toolUseId: callId,
    output: 'ok',
    isError: false,
    parentId: assistantId,
  })])
  const catalog = new CapabilityCatalog()
  const capabilities = new CapabilityProjector().project(
    catalog.publish([{
      name: 'inspect',
      description: 'Inspect nested data',
      source: 'builtin',
      priority: 100,
    }]),
    {
      boundary: 'request-deep-freeze',
      mode: 'headless',
      provider: 'scripted',
      model: 'scripted-model',
    },
  )
  const requestContext = createRequestContext(
    createRuntimeContext({
      runtimeId: 'runtime-deep-freeze',
      configurationRevision: 1,
      modelAdapter: 'scripted',
      startedAt: 1,
    }),
    createSessionStateStore({}),
    'request-deep-freeze',
  )
  const projection = new RequestProjector(store).projectWithReport(
    {
      requestContext,
      conversation: store.snapshot(),
      capabilities,
      tools: [Object.freeze({
        name: 'inspect',
        description: 'Inspect nested data',
        inputSchema: Object.freeze({
          type: 'object',
          properties: { options: { type: 'object' } },
        }),
      })],
      model: 'scripted-model',
    },
    {
      historyStart: 1,
      userContext: 'cwd=/workspace',
      maxToolResultChars: 1,
      toolResultPreviewChars: 1,
    },
  )
  const request = projection.request

  const assistant = request.messages.find(message => message.role === 'assistant')
  assert.ok(assistant && assistant.role === 'assistant')
  const call = assistant.toolCalls?.[0]
  assert.ok(call)
  const options = call.input.options as { limit: number; tags: string[] }
  const properties = request.tools[0]!.inputSchema.properties as Record<string, unknown>
  assert.equal(Object.isFrozen(request), true)
  assert.equal(Object.isFrozen(request.messages), true)
  assert.equal(Object.isFrozen(assistant), true)
  assert.equal(Object.isFrozen(assistant.toolCalls), true)
  assert.equal(Object.isFrozen(call.input), true)
  assert.equal(Object.isFrozen(options), true)
  assert.equal(Object.isFrozen(options.tags), true)
  assert.equal(Object.isFrozen(request.tools[0]!.inputSchema), true)
  assert.equal(Object.isFrozen(properties), true)
  assert.deepEqual(projection.report, {
    sourceCount: 3,
    selectedCount: 2,
    projectedCount: 3,
    omittedBeforeHistoryStart: 1,
    replacedToolResultCount: 1,
    userContextInjected: true,
    strictValidation: 'passed',
  })
  const durableResult = store.snapshot().messages[2]
  assert.equal(durableResult?.kind === 'tool-result' && durableResult.output, 'ok')
  assert.throws(() => { options.limit = 99 }, TypeError)
})

test('strict request validation rejects a history start at an orphan tool result', () => {
  const store = new ConversationStore()
  const humanId = envelopeId('message-human')
  const assistantId = envelopeId('message-assistant')
  const callId = toolUseId('call-orphan')
  store.append(0, [Object.freeze({ kind: 'human' as const, id: humanId, text: 'run' })])
  store.append(1, [Object.freeze({
    kind: 'assistant' as const,
    id: assistantId,
    responseId: responseId('response-orphan'),
    parentId: humanId,
    blocks: Object.freeze([toolUseBlock(callId, 'inspect', {})]),
  })])
  store.append(2, [Object.freeze({
    kind: 'tool-result' as const,
    id: envelopeId('message-result'),
    toolUseId: callId,
    output: 'ok',
    isError: false,
    parentId: assistantId,
  })])
  const catalog = new CapabilityCatalog()
  const capabilities = new CapabilityProjector().project(
    catalog.publish([{ name: 'inspect', description: 'Inspect', source: 'builtin', priority: 1 }]),
    { boundary: 'request-orphan', mode: 'headless', provider: 'scripted', model: 'scripted-model' },
  )
  const requestContext = createRequestContext(
    createRuntimeContext({
      runtimeId: 'runtime-orphan', configurationRevision: 1,
      modelAdapter: 'scripted', startedAt: 1,
    }),
    createSessionStateStore({}),
    'request-orphan',
  )

  assert.throws(() => new RequestProjector(store).projectWithReport({
    requestContext,
    conversation: store.snapshot(),
    capabilities,
    tools: [{ name: 'inspect', description: 'Inspect', inputSchema: { type: 'object' } }],
    model: 'scripted-model',
  }, { historyStart: 2 }), /orphan or duplicate tool result/)
})

test('cancellation during the model call prevents another request', async () => {
  const controller = new AbortController()
  const model = new ScriptedModelAdapter([
    (_request, _index, signal) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('model aborted')), { once: true })
      setImmediate(() => controller.abort('test model cancellation'))
      void resolve
    }),
  ])
  const fixture = createFixture(model, [])

  const result = await fixture.runtime.submit('cancel the model', controller.signal)

  assert.equal(result.status, 'cancelled')
  assert.equal(model.requests.length, 1)
})

test('cancellation wins when a model adapter resolves a late response', async () => {
  const controller = new AbortController()
  const model = new ScriptedModelAdapter([
    () => {
      controller.abort('cancelled before late response commit')
      return {
        responseId: 'response-late',
        text: 'must not be committed',
        toolCalls: [],
      }
    },
  ])
  const fixture = createFixture(model, [])

  const result = await fixture.runtime.submit('cancel the late model', controller.signal)

  assert.equal(result.status, 'cancelled')
  assert.equal(result.finalText, undefined)
  assert.equal(
    fixture.store.snapshot().messages.some(message => message.kind === 'assistant'),
    false,
  )
})

test('trace sink failure and content-bearing attributes do not own the run', async () => {
  const model = new ScriptedModelAdapter([
    () => ({ responseId: 'response-1', text: 'done', toolCalls: [] }),
  ])
  const registry = new AgentToolRegistry()
  const catalog = new CapabilityCatalog()
  const trace = new TraceRecorder([{
    write() { throw new Error('trace backend unavailable') },
  }])
  await trace.record('run-test', 'bad.trace', { prompt: 'must not be written' })
  const runtime = new AgentRuntime({
    model,
    tools: registry,
    permissionGate: new PolicyPermissionGate(),
    catalog,
    runtimeContext: createRuntimeContext({
      runtimeId: 'runtime-trace-test',
      configurationRevision: 1,
      modelAdapter: model.provider,
      startedAt: 1,
    }),
    sessionState: createSessionStateStore({}),
    workspace: process.cwd(),
    mode: 'headless',
    trace,
  })

  const result = await runtime.submit('trace must not own this run', new AbortController().signal)

  assert.equal(result.status, 'completed')
  assert.equal(trace.errors().some(error => error.includes('content-bearing')), true)
  assert.equal(trace.errors().some(error => error.includes('backend unavailable')), true)
})

function createFixture(
  model: ScriptedModelAdapter,
  tools: readonly AgentTool[],
  gate: PermissionGate = new PolicyPermissionGate(),
  maxTurns = 4,
  options: Readonly<{
    events?: AgentEventSink
    sessionState?: SessionStateStore
    conversation?: ConversationStore
    requestProjectionPolicy?: RequestProjectionPolicy
  }> = {},
): {
  runtime: AgentRuntime
  store: ConversationStore
  trace: MemoryTraceSink
  sessionState: SessionStateStore
} {
  const registry = new AgentToolRegistry()
  for (const candidate of tools) registry.register(candidate)
  const catalog = new CapabilityCatalog()
  catalog.publish(registry.names().map(name => ({
    name,
    description: name,
    source: 'builtin',
    priority: 100,
  })))
  const store = options.conversation ?? new ConversationStore()
  const trace = new MemoryTraceSink()
  const sessionState = options.sessionState ?? createSessionStateStore({})
  const runtime = new AgentRuntime({
    model,
    tools: registry,
    permissionGate: gate,
    catalog,
    runtimeContext: createRuntimeContext({
      runtimeId: 'runtime-test',
      configurationRevision: 1,
      modelAdapter: model.provider,
      startedAt: 1,
    }),
    sessionState,
    workspace: process.cwd(),
    mode: 'headless',
    maxTurns,
    conversation: store,
    trace: new TraceRecorder([trace], () => new Date('2026-01-01T00:00:00Z')),
    events: options.events,
    requestProjectionPolicy: options.requestProjectionPolicy,
    ids: new MonotonicIdSource(),
  })
  return { runtime, store, trace, sessionState }
}

function tool(
  name: string,
  risk: AgentTool['risk'],
  execute: AgentTool['execute'],
  permissionRequest: AgentTool['permissionRequest'] = () => ({ toolName: name, risk }),
): AgentTool {
  return {
    name,
    description: `${name} test tool`,
    inputSchema: { type: 'object' },
    risk,
    permissionRequest,
    execute,
  }
}
