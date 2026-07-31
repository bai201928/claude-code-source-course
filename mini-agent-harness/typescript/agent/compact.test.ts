import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityCatalog } from '../capabilityProjection.ts'
import {
  ConversationStore,
  envelopeId,
  responseId,
  textBlock,
  toolUseBlock,
  toolUseId,
  type DurableMessage,
} from '../conversationStore.ts'
import { createRuntimeContext, createSessionStateStore } from '../runtimeContext.ts'
import {
  CompactCancelledError,
  CompactCoordinator,
  CompactInvariantError,
  InMemoryCompactJournal,
  recoverCompaction,
  type ConversationSummarizer,
} from './compact.ts'
import { PolicyPermissionGate } from './permissions.ts'
import { AgentRuntime, MonotonicIdSource } from './runtime.ts'
import { ScriptedModelAdapter } from './testing.ts'
import { AgentToolRegistry } from './tools.ts'
import { MemoryTraceSink, TraceRecorder } from './trace.ts'

test('AgentRuntime compact commits one revision and emits metadata-only trace', async () => {
  const store = new ConversationStore(history())
  const journal = new InMemoryCompactJournal()
  const traceSink = new MemoryTraceSink()
  const runtime = runtimeFor(store, journal, traceSink)

  const result = await runtime.compact(
    summarizer('Earlier work established the workspace and completed one tool call.'),
    { retainLast: 1 },
    new AbortController().signal,
  )

  assert.equal(result.sourceRevision, 0)
  assert.equal(result.committedRevision, 1)
  assert.deepEqual(journal.records().map(record => record.phase), ['prepared', 'committed'])
  assert.deepEqual(
    store.snapshot().messages.map(message => message.kind),
    ['system', 'system', 'system', 'human'],
  )
  store.assertRequestReady(store.snapshot())
  assert.deepEqual(
    traceSink.events.map(event => event.type),
    ['compact.started', 'compact.prepared', 'compact.committed'],
  )
  assert.equal(
    traceSink.events.some(event =>
      Object.keys(event.attributes).some(key => ['content', 'messages', 'text'].includes(key)),
    ),
    false,
  )
})

test('summary cancellation changes neither owner nor journal', async () => {
  const store = new ConversationStore(history())
  const journal = new InMemoryCompactJournal()
  const runtime = runtimeFor(store, journal)
  const before = store.snapshot()
  const controller = new AbortController()

  await assert.rejects(
    runtime.compact({
      async summarize() {
        controller.abort()
        return 'must not commit'
      },
    }, { retainLast: 1 }, controller.signal),
    CompactCancelledError,
  )

  assert.deepEqual(store.snapshot(), before)
  assert.deepEqual(journal.records(), [])
})

test('cancellation after prepared record leaves recoverable original history', async () => {
  const controller = new AbortController()
  const journal = new InMemoryCompactJournal(record => {
    if (record.phase === 'prepared') controller.abort()
  })
  const store = new ConversationStore(history())
  const runtime = runtimeFor(store, journal)

  await assert.rejects(
    runtime.compact(summarizer('summary'), { retainLast: 1 }, controller.signal),
    CompactCancelledError,
  )

  assert.equal(store.revision, 0)
  assert.deepEqual(journal.records().map(record => record.phase), ['prepared'])
  const recovered = recoverCompaction(store.snapshot(), journal.records())
  assert.equal(recovered.report.status, 'fell_back')
  assert.equal(recovered.report.reason, 'prepared_only')
  assert.deepEqual(recovered.messages, history())
})

test('stale plan is rejected before journal mutation', async () => {
  const store = new ConversationStore(history())
  const journal = new InMemoryCompactJournal()
  const coordinator = new CompactCoordinator(store, journal)
  const plan = await coordinator.prepare(
    summarizer('summary'),
    { transactionId: 'tx-1', boundaryId: 'boundary-1', summaryId: 'summary-1', retainLast: 1 },
    new AbortController().signal,
  )
  store.append(store.revision, [{
    kind: 'human',
    id: envelopeId('late-writer'),
    text: 'late writer',
    parentId: envelopeId('human-2'),
  }])
  const owner = {}
  store.bindRuntime(owner)
  const lease = store.acquireRun(owner)

  assert.throws(
    () => coordinator.commit(plan, lease, new AbortController().signal),
    CompactInvariantError,
  )
  store.releaseRun(owner, lease)
  assert.deepEqual(journal.records(), [])
  assert.equal(store.revision, 1)
})

test('retained tail expands backward to keep an assistant tool-use/result pair', async () => {
  const store = new ConversationStore(history())
  const coordinator = new CompactCoordinator(store)
  const plan = await coordinator.prepare(
    summarizer('summary'),
    { transactionId: 'tx-pair', boundaryId: 'boundary-pair', summaryId: 'summary-pair', retainLast: 2 },
    new AbortController().signal,
  )

  assert.deepEqual(plan.provenance.retainedMessageIds, [
    envelopeId('assistant-1'),
    envelopeId('result-1'),
    envelopeId('human-2'),
  ])
  const candidate = new ConversationStore(plan.replacement)
  candidate.assertRequestReady(candidate.snapshot())
})

function runtimeFor(
  store: ConversationStore,
  journal: InMemoryCompactJournal,
  traceSink = new MemoryTraceSink(),
): AgentRuntime {
  return new AgentRuntime({
    model: new ScriptedModelAdapter([]),
    tools: new AgentToolRegistry(),
    permissionGate: new PolicyPermissionGate(),
    catalog: new CapabilityCatalog(),
    runtimeContext: createRuntimeContext({
      runtimeId: 'compact-runtime',
      configurationRevision: 1,
      modelAdapter: 'scripted',
      startedAt: 1,
    }),
    sessionState: createSessionStateStore({}),
    workspace: process.cwd(),
    mode: 'headless',
    conversation: store,
    compactJournal: journal,
    trace: new TraceRecorder([traceSink], () => new Date('2026-01-01T00:00:00Z')),
    ids: new MonotonicIdSource(),
  })
}

function summarizer(summary: string): ConversationSummarizer {
  return { async summarize() { return summary } }
}

function history(): readonly DurableMessage[] {
  return [
    { kind: 'system', id: envelopeId('system-1'), text: 'You are an agent.' },
    { kind: 'human', id: envelopeId('human-1'), text: 'Read the file.', parentId: envelopeId('system-1') },
    {
      kind: 'assistant',
      id: envelopeId('assistant-1'),
      responseId: responseId('response-1'),
      blocks: [textBlock('I will inspect it.'), toolUseBlock(toolUseId('call-1'), 'read_file', { path: 'a.txt' })],
      parentId: envelopeId('human-1'),
    },
    {
      kind: 'tool-result',
      id: envelopeId('result-1'),
      toolUseId: toolUseId('call-1'),
      output: 'content',
      isError: false,
      parentId: envelopeId('assistant-1'),
    },
    { kind: 'human', id: envelopeId('human-2'), text: 'Continue.', parentId: envelopeId('result-1') },
  ]
}
