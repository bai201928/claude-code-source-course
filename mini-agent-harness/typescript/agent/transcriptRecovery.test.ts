import assert from 'node:assert/strict'
import {
  RecoveryReducer,
  ResumeCoordinator,
  TranscriptStore,
  decodeTranscriptJsonl,
  encodeTranscriptJsonl,
  type TranscriptRecord,
} from './transcriptRecovery.ts'
import { DurableScheduler } from './workCoordinator.ts'

let passed = 0
const test = (name: string, body: () => void) => {
  body()
  passed++
  process.stdout.write(`ok ${passed} - ${name}\n`)
}

const message = (
  recordId: string,
  messageId: string,
  parentMessageId: string | null,
  sequence: number,
  extra: Partial<Extract<TranscriptRecord, { type: 'message' }>> = {},
): Extract<TranscriptRecord, { type: 'message' }> => ({
  schemaVersion: 1,
  type: 'message',
  recordId,
  sessionId: 's1',
  sequence,
  messageId,
  parentMessageId,
  role: 'user',
  ...extra,
})

test('record id append is idempotent but stale revision is rejected', () => {
  const store = new TranscriptStore()
  const first = message('r1', 'm1', null, 1)
  store.append(first)
  store.append(first)
  assert.equal(store.revision, 1)
  assert.throws(() => store.append(message('r2', 'm2', 'm1', 2), 0), /stale transcript revision/)
})

test('JSONL keeps valid records and reports malformed middle plus partial tail', () => {
  const valid = JSON.stringify(message('r1', 'm1', null, 1))
  const decoded = decodeTranscriptJsonl(`${valid}\nnot-json\n{"schemaVersion":1`)
  assert.equal(decoded.report.acceptedRecords, 1)
  assert.deepEqual(decoded.report.malformedLineNumbers, [2])
  assert.equal(decoded.report.partialTailIgnored, true)
  assert.equal(encodeTranscriptJsonl(decoded.store.exportState()), `${valid}\n`)
})

test('dangling parent returns a partial chain and makes incompleteness visible', () => {
  const store = new TranscriptStore()
  store.append(message('r1', 'm2', 'missing', 1))
  const snapshot = new RecoveryReducer().reduce(store, 's1')
  assert.deepEqual(snapshot.messages.map(item => item.messageId), ['m2'])
  assert.deepEqual(snapshot.report.danglingParentIds, ['missing'])
  assert.equal(snapshot.report.completeChain, false)
})

test('parent cycle terminates without looping', () => {
  const store = new TranscriptStore()
  store.append(message('r1', 'm1', 'm2', 1))
  store.append(message('r2', 'm2', 'm1', 2))
  const snapshot = new RecoveryReducer().reduce(store, 's1', { leafMessageId: 'm2' })
  assert.deepEqual(snapshot.report.cycleMessageIds, ['m2'])
  assert.equal(snapshot.report.completeChain, false)
})

test('parallel assistant sibling and its tool result are recovered', () => {
  const store = new TranscriptStore()
  store.append(message('r1', 'u1', null, 1))
  store.append(message('r2', 'a1', 'u1', 2, { role: 'assistant', parallelGroupId: 'p1', toolUseIds: ['t1'] }))
  store.append(message('r3', 'a2', 'a1', 3, { role: 'assistant', parallelGroupId: 'p1', toolUseIds: ['t2'] }))
  store.append(message('r4', 'tr1', 'a1', 4, { role: 'tool', sourceAssistantMessageId: 'a1', toolResultIds: ['t1'] }))
  store.append(message('r5', 'tr2', 'a2', 5, { role: 'tool', sourceAssistantMessageId: 'a2', toolResultIds: ['t2'] }))
  store.append(message('r6', 'u2', 'tr1', 6))
  const snapshot = new RecoveryReducer().reduce(store, 's1', { leafMessageId: 'u2' })
  assert(snapshot.messages.some(item => item.messageId === 'a2'))
  assert(snapshot.messages.some(item => item.messageId === 'tr2'))
  assert.deepEqual(snapshot.report.recoveredParallelMessageIds, ['a2', 'tr2'])
})

test('fully unresolved assistant tool use is filtered and reported', () => {
  const store = new TranscriptStore()
  store.append(message('r1', 'u1', null, 1, { content: 'secret-prompt' }))
  store.append(message('r2', 'a1', 'u1', 2, { role: 'assistant', content: 'secret-text', toolUseIds: ['t1'] }))
  const snapshot = new RecoveryReducer().reduce(store, 's1')
  assert.deepEqual(snapshot.messages.map(item => item.messageId), ['u1'])
  assert.deepEqual(snapshot.report.unresolvedToolUseIds, ['t1'])
  assert(!JSON.stringify(snapshot.report).includes('secret'))
})

test('effect phases and orphaned background attempts recover conservatively', () => {
  const store = new TranscriptStore()
  store.append({ schemaVersion: 1, type: 'effect', recordId: 'e1p', sessionId: 's1', sequence: 1, effectId: 'e1', toolUseId: 't1', idempotencyKey: 'k1', phase: 'prepared' })
  store.append({ schemaVersion: 1, type: 'effect', recordId: 'e2p', sessionId: 's1', sequence: 2, effectId: 'e2', toolUseId: 't2', idempotencyKey: 'k2', phase: 'prepared' })
  store.append({ schemaVersion: 1, type: 'effect', recordId: 'e2a', sessionId: 's1', sequence: 3, effectId: 'e2', toolUseId: 't2', idempotencyKey: 'k2', phase: 'attempted' })
  store.append({ schemaVersion: 1, type: 'effect', recordId: 'e3c', sessionId: 's1', sequence: 4, effectId: 'e3', toolUseId: 't3', idempotencyKey: 'k3', phase: 'committed' })
  store.append({ schemaVersion: 1, type: 'background', recordId: 'b1', sessionId: 's1', sequence: 5, executionId: 'x1', attempt: 1, phase: 'started', restartPolicy: 'manual' })
  const snapshot = new RecoveryReducer().reduce(store, 's1')
  assert.deepEqual(snapshot.report.preparedEffectIds, ['e1'])
  assert.deepEqual(snapshot.report.indeterminateEffectIds, ['e2'])
  assert.deepEqual(snapshot.report.committedEffectIds, ['e3'])
  assert.deepEqual(snapshot.report.orphanedExecutionIds, ['x1'])
})

test('normal resume keeps identity while fork mints isolated identities', () => {
  const store = new TranscriptStore()
  store.append(message('r1', 'm1', null, 1))
  store.append({ schemaVersion: 1, type: 'background', recordId: 'b1', sessionId: 's1', sequence: 2, executionId: 'x1', attempt: 1, phase: 'started', restartPolicy: 'manual' })
  const ids = ['fork-session', 'fork-message', 'fork-session-record', 'fork-message-record']
  const coordinator = new ResumeCoordinator(store, { nextId: () => ids.shift()! })
  const normal = coordinator.resume({ sessionId: 's1', mode: 'normal' })
  const fork = coordinator.resume({ sessionId: 's1', mode: 'fork' })
  assert.equal(normal.sessionId, 's1')
  assert.equal(fork.sessionId, 'fork-session')
  assert.equal(fork.messages[0]!.sourceMessageId, 'm1')
  assert.notEqual(fork.messages[0]!.messageId, 'm1')
  assert.deepEqual(fork.report.orphanedExecutionIds, [])
  assert.deepEqual(normal.report.orphanedExecutionIds, ['x1'])
})

test('scheduler takeover preserves pending trigger id until explicit commit', () => {
  const store = new TranscriptStore()
  store.append(message('r1', 'm1', null, 1))
  const scheduler = new DurableScheduler()
  scheduler.schedule({ scheduleId: 'cron-1', workItemId: 'work-1', nextRunAt: 10 })
  const [trigger] = scheduler.poll(10)
  const resumed = new ResumeCoordinator(store).resume({
    sessionId: 's1',
    mode: 'normal',
    schedulerState: scheduler.exportState(),
  })
  assert.deepEqual(resumed.report.pendingTriggerIds, [trigger!.triggerId])
  assert.deepEqual(resumed.schedulerState!.pending.map(item => item.triggerId), [trigger!.triggerId])
})

process.stdout.write(`1..${passed}\n`)
