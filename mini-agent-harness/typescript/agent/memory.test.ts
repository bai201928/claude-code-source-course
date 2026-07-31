import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MemoryProjector,
  MemoryRevisionConflictError,
  MemoryStore,
  MemoryTransitionError,
  type MemoryCandidateInput,
} from './memory.ts'

const scope = { kind: 'project' as const, key: 'repo-a' }
const session = { kind: 'session' as const, key: 'session-1' }

test('candidate is not recallable until explicitly accepted', () => {
  const store = new MemoryStore(() => 1_000)
  store.propose(0, candidate('m1', 'style', 'Use TypeScript', scope))
  assert.equal(store.recall(scope, 'TypeScript').length, 0)
  store.transition(1, 'm1', 'accepted', { retentionMs: 500 })
  assert.equal(store.recall(scope, 'TypeScript', { nowMs: 1_200 }).length, 1)
})

test('project and session scopes are isolated', () => {
  const store = new MemoryStore(() => 1_000)
  store.propose(0, candidate('project', 'rule', 'project rule', scope))
  store.transition(1, 'project', 'accepted')
  store.propose(2, candidate('session', 'rule', 'session rule', session))
  store.transition(3, 'session', 'accepted')
  assert.deepEqual(store.recall(scope, '').map(item => item.record.id), ['project'])
  assert.deepEqual(store.recall(session, '').map(item => item.record.id), ['session'])
})

test('duplicate active candidates merge without creating a second record', () => {
  const store = new MemoryStore(() => 1_000)
  store.propose(0, candidate('m1', 'preference', 'compact output', scope))
  const merged = store.propose(1, candidate('m2', 'preference', 'different text', scope))
  assert.equal(merged.revision, 1)
  assert.deepEqual(merged.records.map(item => item.id), ['m1'])
  assert.equal(store.traces().at(-1)?.operation, 'merge')
})

test('stale revision cannot accept or update a memory', () => {
  const store = new MemoryStore(() => 1_000)
  store.propose(0, candidate('m1', 'key', 'value', scope))
  assert.throws(() => store.transition(0, 'm1', 'accepted'), MemoryRevisionConflictError)
  store.transition(1, 'm1', 'accepted')
  assert.throws(() => store.updateAccepted(1, 'm1', {
    content: 'new value',
    provenance: provenance('source-2'),
  }), MemoryRevisionConflictError)
})

test('retention expiry removes memory from recall', () => {
  const store = new MemoryStore(() => 1_000)
  store.propose(0, candidate('m1', 'temporary', 'expires quickly', scope))
  store.transition(1, 'm1', 'accepted', { retentionMs: 10 })
  assert.equal(store.recall(scope, '', { nowMs: 1_009 }).length, 1)
  store.expire(2, 1_010)
  assert.equal(store.recall(scope, '', { nowMs: 1_010 }).length, 0)
  assert.equal(store.snapshot().records[0]?.status, 'expired')
})

test('recall is deterministic and bounded by item and character budgets', () => {
  const store = new MemoryStore(() => 1_000)
  store.propose(0, candidate('a', 'alpha', 'alpha one', scope))
  store.transition(1, 'a', 'accepted')
  store.propose(2, candidate('b', 'beta', 'alpha two', scope))
  store.transition(3, 'b', 'accepted')
  const recalled = store.recall(scope, 'alpha', { limit: 1, maxChars: 5 })
  assert.equal(recalled.length, 1)
  assert.equal(recalled[0]?.content.length, 5)
  assert.equal(recalled[0]?.truncated, true)
})

test('projector formats accepted memories while trace remains content-free', () => {
  const store = new MemoryStore(() => 1_000)
  store.propose(0, candidate('m1', 'language', 'Answer in Chinese', scope))
  store.transition(1, 'm1', 'accepted')
  const projection = new MemoryProjector(store).project(scope, 'language', { maxChars: 100 })
  assert.match(projection.text, /Answer in Chinese/)
  assert.equal(JSON.stringify(store.traces()).includes('Answer in Chinese'), false)
  assert.equal(JSON.stringify(store.traces()).includes('language'), false)
})

test('only accepted records can be updated and superseded', () => {
  const store = new MemoryStore(() => 1_000)
  store.propose(0, candidate('old', 'rule', 'old', scope))
  store.propose(1, candidate('new', 'new-rule', 'new', scope))
  assert.throws(() => store.transition(2, 'old', 'superseded'), MemoryTransitionError)
  store.transition(2, 'old', 'accepted')
  store.transition(3, 'new', 'accepted')
  store.transition(4, 'old', 'superseded', { supersededBy: 'new' })
  assert.equal(store.snapshot().records.find(item => item.id === 'old')?.status, 'superseded')
})

function provenance(sourceId: string) {
  return { sourceKind: 'user' as const, sourceIds: [sourceId], capturedAt: 1_000 }
}

function candidate(id: string, key: string, content: string, memoryScope: typeof scope | typeof session): MemoryCandidateInput {
  return { id, key, content, scope: memoryScope, provenance: provenance(id) }
}
