import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CompactCancelledError,
  CompactConversationOwner,
  InMemoryCompactJournal,
  StaleCompactRevisionError,
  commitCompact,
  prepareCompact,
  recoverCompact,
  type CompactJournalRecord,
  type CompactMessage,
} from './compact-transaction.ts'

const messages = (): readonly CompactMessage[] => [
  { id: 'h-1', kind: 'human', content: 'inspect the repository' },
  { id: 'a-1', kind: 'assistant', content: 'I will read it' },
  { id: 'tu-1', kind: 'tool-use', content: 'read', toolUseId: 'call-1' },
  { id: 'tr-1', kind: 'tool-result', content: 'large result', toolUseId: 'call-1' },
  { id: 'a-2', kind: 'assistant', content: 'the result means X' },
]

const summarizer = {
  async summarize(input: readonly CompactMessage[]) {
    return `summary of ${input.map(message => message.id).join(',')}`
  },
}

async function planFor(owner: CompactConversationOwner, retainLast = 1) {
  return prepareCompact(owner.snapshot(), summarizer, {
    transactionId: 'tx-1',
    boundaryId: 'boundary-1',
    summaryId: 'summary-1',
    retainLast,
  }, new AbortController().signal)
}

test('summary cancellation leaves owner and journal unchanged', async () => {
  const owner = new CompactConversationOwner(messages(), 3)
  const before = owner.snapshot()
  const controller = new AbortController()
  const cancelling = {
    async summarize() {
      controller.abort('cancel summary')
      return 'late summary'
    },
  }
  await assert.rejects(
    prepareCompact(before, cancelling, {
      transactionId: 'tx-cancel', boundaryId: 'b-cancel', summaryId: 's-cancel', retainLast: 1,
    }, controller.signal),
    CompactCancelledError,
  )
  assert.deepEqual(owner.snapshot(), before)
})

test('cancellation after prepared record leaves original owner intact', async () => {
  const owner = new CompactConversationOwner(messages(), 4)
  const before = owner.snapshot()
  const plan = await planFor(owner)
  const controller = new AbortController()
  const journal = new InMemoryCompactJournal(record => {
    if (record.phase === 'prepared') controller.abort('cancel before commit')
  })
  assert.throws(() => commitCompact(owner, plan, journal, controller.signal), CompactCancelledError)
  assert.deepEqual(owner.snapshot(), before)
  const recovered = recoverCompact(before, journal.records())
  assert.equal(recovered.report.status, 'fell_back')
  assert.equal(recovered.report.reason, 'prepared_only')
})

test('stale plan is rejected before journal or owner mutation', async () => {
  const owner = new CompactConversationOwner(messages(), 2)
  const plan = await planFor(owner)
  owner.append(2, [{ id: 'h-late', kind: 'human', content: 'new fact' }])
  const journal = new InMemoryCompactJournal()
  assert.throws(
    () => commitCompact(owner, plan, journal, new AbortController().signal),
    StaleCompactRevisionError,
  )
  assert.equal(journal.records().length, 0)
  assert.equal(owner.snapshot().messages.at(-1)?.id, 'h-late')
})

test('complete commit advances one revision and restores byte-stable view', async () => {
  const owner = new CompactConversationOwner(messages(), 7)
  const plan = await planFor(owner)
  const journal = new InMemoryCompactJournal()
  const committed = commitCompact(owner, plan, journal, new AbortController().signal)
  assert.equal(committed.revision, 8)
  assert.deepEqual(committed.messages.map(message => message.kind), [
    'compact-boundary', 'compact-summary', 'assistant',
  ])
  const recovered = recoverCompact({ revision: 7, messages: messages() }, journal.records())
  assert.equal(recovered.report.status, 'restored')
  assert.deepEqual(recovered.snapshot, committed)
})

test('retained boundary expands backward to preserve a tool pair', async () => {
  const owner = new CompactConversationOwner(messages(), 1)
  const plan = await planFor(owner, 2)
  assert.deepEqual(plan.provenance.retainedMessageIds, ['tu-1', 'tr-1', 'a-2'])
})

test('boundary-only committed record falls back with repair metadata', async () => {
  const owner = new CompactConversationOwner(messages(), 5)
  const plan = await planFor(owner)
  const record: CompactJournalRecord = {
    phase: 'committed',
    original: plan.original,
    replacement: plan.replacement.filter(message => message.kind !== 'compact-summary'),
    provenance: plan.provenance,
  }
  const result = recoverCompact(owner.snapshot(), [record])
  assert.equal(result.report.status, 'repair_required')
  assert.equal(result.report.reason, 'missing_summary')
  assert.deepEqual(result.snapshot, owner.snapshot())
})

test('summary-only committed record falls back with repair metadata', async () => {
  const owner = new CompactConversationOwner(messages(), 5)
  const plan = await planFor(owner)
  const record: CompactJournalRecord = {
    phase: 'committed',
    original: plan.original,
    replacement: plan.replacement.filter(message => message.kind !== 'compact-boundary'),
    provenance: plan.provenance,
  }
  const result = recoverCompact(owner.snapshot(), [record])
  assert.equal(result.report.status, 'repair_required')
  assert.equal(result.report.reason, 'missing_boundary')
})

test('malformed provenance falls back and report contains no message content', async () => {
  const owner = new CompactConversationOwner(messages(), 5)
  const plan = await planFor(owner)
  const record: CompactJournalRecord = {
    phase: 'committed',
    original: plan.original,
    replacement: plan.replacement,
    provenance: { ...plan.provenance, sourceMessageIds: ['wrong'] },
  }
  const result = recoverCompact(owner.snapshot(), [record])
  assert.equal(result.report.status, 'repair_required')
  assert.equal(result.report.reason, 'malformed_provenance')
  const serialized = JSON.stringify(result.report)
  assert.equal(serialized.includes('large result'), false)
  assert.equal(serialized.includes('summary of'), false)
})

