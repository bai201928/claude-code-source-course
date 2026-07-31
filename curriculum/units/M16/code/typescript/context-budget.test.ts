import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ContextProjectionError,
  ResultBudgetLedger,
  StaleReplacementRevisionError,
  applyPerResultPreview,
  assertStrictPairing,
  naiveGlobalSuffix,
  planAggregateProjection,
  projectAndCommit,
  totalToolResultChars,
  type Envelope,
} from './context-budget.ts'

function threeResults(): Envelope[] {
  return [
    { kind: 'assistant', responseId: 'response-1', calls: [
      { id: 'a', name: 'search' },
      { id: 'b', name: 'search' },
      { id: 'c', name: 'search' },
    ] },
    { kind: 'tool-result', callId: 'a', content: 'A'.repeat(80) },
    { kind: 'progress', callId: 'b', text: 'halfway' },
    { kind: 'tool-result', callId: 'b', content: 'B'.repeat(80) },
    { kind: 'attachment', text: 'workspace changed' },
    { kind: 'assistant', responseId: 'response-1', calls: [] },
    { kind: 'tool-result', callId: 'c', content: 'C'.repeat(80) },
  ]
}

test('naive global suffix can orphan a tool result', () => {
  assert.throws(
    () => naiveGlobalSuffix(threeResults(), 170),
    ContextProjectionError,
  )
})

test('per-result preview does not enforce the final group budget', () => {
  const projected = applyPerResultPreview(threeResults(), 100, 8)
  assert.equal(totalToolResultChars(projected), 240)
})

test('aggregate group budget is copy-on-write and content-free in its report', () => {
  const source = threeResults()
  const before = structuredClone(source)
  const result = projectAndCommit(source, new ResultBudgetLedger(), {
    maxGroupChars: 220,
    previewChars: 4,
  })

  assert.deepEqual(source, before)
  assert.equal(result.report.groups.length, 1)
  assert.equal(result.report.groups[0]?.overBudget, false)
  assert.equal(result.report.newlyReplacedCount, 1)
  assert.equal(JSON.stringify(result.report).includes('AAAA'), false)
  assert.doesNotThrow(() => assertStrictPairing(result.messages))
})

test('replacement is byte-stable on the next projection', () => {
  const ledger = new ResultBudgetLedger()
  const first = projectAndCommit(threeResults(), ledger, {
    maxGroupChars: 220,
    previewChars: 4,
  })
  const second = projectAndCommit(threeResults(), ledger, {
    maxGroupChars: 220,
    previewChars: 4,
  })
  assert.deepEqual(first.messages, second.messages)
  assert.equal(second.report.newlyReplacedCount, 0)
  assert.equal(second.report.reappliedCount, 1)
  assert.equal(second.report.replacementRevision, 1)
})

test('progress, attachment, and same-response fragments do not split a group', () => {
  const result = projectAndCommit(threeResults(), new ResultBudgetLedger(), {
    maxGroupChars: 220,
    previewChars: 4,
  })
  assert.equal(result.report.groups.length, 1)
  assert.equal(result.report.groups[0]?.resultCount, 3)
  assert.equal(result.report.newlyReplacedCount, 1)
})

test('self-bounded results can leave a wrapper group over budget', () => {
  const source: Envelope[] = [
    { kind: 'assistant', responseId: 'response-2', calls: [
      { id: 'read', name: 'read_file' },
    ] },
    {
      kind: 'tool-result',
      callId: 'read',
      content: 'R'.repeat(240),
      selfBounded: true,
    },
  ]
  const result = projectAndCommit(source, new ResultBudgetLedger(), {
    maxGroupChars: 100,
    previewChars: 4,
  })
  assert.equal(result.report.newlyReplacedCount, 0)
  assert.equal(result.report.groups[0]?.excludedCount, 1)
  assert.equal(result.report.groups[0]?.overBudget, true)
})

test('post-projection validation rejects an orphan history start', () => {
  assert.throws(
    () => projectAndCommit(threeResults(), new ResultBudgetLedger(), {
      historyStart: 1,
      maxGroupChars: 200,
      previewChars: 4,
    }),
    /orphan or duplicate tool result/,
  )
})

test('replacement ledger rejects a stale writer', () => {
  const ledger = new ResultBudgetLedger()
  const snapshot = ledger.snapshot()
  const first = planAggregateProjection(threeResults(), snapshot, {
    maxGroupChars: 190,
    previewChars: 4,
  })
  const stale = planAggregateProjection(threeResults(), snapshot, {
    maxGroupChars: 180,
    previewChars: 2,
  })
  ledger.commit(first.ledgerCommit)
  assert.throws(
    () => ledger.commit(stale.ledgerCommit),
    StaleReplacementRevisionError,
  )
})
