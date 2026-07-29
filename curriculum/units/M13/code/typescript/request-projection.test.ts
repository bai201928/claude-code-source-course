import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ProjectionError,
  buildFinalParams,
  createContentReplacementState,
  projectRequest,
  type DomainMessage,
} from './request-projection.ts'

const completeToolTurn: readonly DomainMessage[] = [
  { kind: 'human', id: 'u-1', text: 'old question' },
  { kind: 'assistant', id: 'a-1', responseId: 'r-1', blocks: [{ kind: 'text', text: 'old answer' }] },
  { kind: 'compact-boundary', id: 'b-1' },
  { kind: 'human', id: 'u-2', text: 'inspect workspace' },
  {
    kind: 'assistant',
    id: 'a-2',
    responseId: 'r-2',
    blocks: [{ kind: 'tool-use', id: 'call-1', name: 'read', input: { path: 'README.md' } }],
  },
  { kind: 'progress', id: 'p-1', detail: 'reading' },
  { kind: 'tool-result', id: 'tr-1', toolUseId: 'call-1', output: 'x'.repeat(120) },
  { kind: 'attachment', id: 'att-1', text: 'branch=main' },
]

test('boundary, progress and request-only context change the view but not durable source', () => {
  const source = structuredClone(completeToolTurn)
  const projected = projectRequest(source, { userContext: 'cwd=/repo' })

  assert.equal(projected.report.omittedBeforeBoundary, 2)
  assert.equal(projected.report.userContextInjected, true)
  assert.equal(JSON.stringify(source), JSON.stringify(completeToolTurn))
  const rendered = JSON.stringify(projected.messages)
  assert.equal(rendered.includes('old question'), false)
  assert.equal(rendered.includes('compact-boundary'), false)
  assert.equal(rendered.includes('reading'), false)
  assert.equal(rendered.includes('cwd=/repo'), true)
  assert.equal(rendered.includes('<system-reminder>'), true)
  assert.equal(rendered.includes('branch=main'), true)
})

test('tool-result budget creates a deterministic preview without changing source content', () => {
  const first = projectRequest(completeToolTurn, { toolResultBudgetChars: 40 })
  const second = projectRequest(completeToolTurn, { toolResultBudgetChars: 40 })

  assert.deepEqual(first, second)
  assert.deepEqual(first.report.replacedToolUseIds, ['call-1'])
  assert.equal(JSON.stringify(first.messages).includes('omitted: 120 chars'), true)
  assert.equal((completeToolTurn[6] as Extract<DomainMessage, { kind: 'tool-result' }>).output.length, 120)
})

test('tool-result budget follows API user groups instead of one global total', () => {
  const separateGroups: readonly DomainMessage[] = [
    {
      kind: 'assistant', id: 'a-1', responseId: 'r-1',
      blocks: [{ kind: 'tool-use', id: 'call-1', name: 'read', input: {} }],
    },
    { kind: 'tool-result', id: 'tr-1', toolUseId: 'call-1', output: 'a'.repeat(80) },
    {
      kind: 'assistant', id: 'a-2', responseId: 'r-2',
      blocks: [{ kind: 'tool-use', id: 'call-2', name: 'read', input: {} }],
    },
    { kind: 'tool-result', id: 'tr-2', toolUseId: 'call-2', output: 'b'.repeat(80) },
  ]

  const projected = projectRequest(separateGroups, { toolResultBudgetChars: 100 })
  assert.deepEqual(projected.report.replacedToolUseIds, [])
})

test('replacement state freezes and reapplies a preview across turns', () => {
  const state = createContentReplacementState()
  const first = projectRequest(completeToolTurn, {
    toolResultBudgetChars: 40,
    replacementState: state,
  })
  const second = projectRequest(completeToolTurn, {
    toolResultBudgetChars: 1_000,
    replacementState: state,
  })

  assert.deepEqual(first.report.replacedToolUseIds, ['call-1'])
  assert.deepEqual(second.report.replacedToolUseIds, ['call-1'])
  assert.equal(JSON.stringify(first.messages), JSON.stringify(second.messages))
  assert.equal(state.seenIds.has('call-1'), true)
  assert.equal(state.replacements.has('call-1'), true)
})

test('a previously visible result stays frozen when fresh content exceeds the group budget', () => {
  const state = createContentReplacementState()
  const messages: readonly DomainMessage[] = [
    {
      kind: 'assistant', id: 'a-1', responseId: 'r-1',
      blocks: [
        { kind: 'tool-use', id: 'call-1', name: 'read', input: {} },
        { kind: 'tool-use', id: 'call-2', name: 'read', input: {} },
      ],
    },
    { kind: 'tool-result', id: 'tr-1', toolUseId: 'call-1', output: 'a'.repeat(60) },
    { kind: 'tool-result', id: 'tr-2', toolUseId: 'call-2', output: 'b'.repeat(20) },
  ]
  projectRequest(messages.slice(0, 2), {
    toolResultBudgetChars: 100,
    replacementState: state,
    pairing: 'repair',
  })
  const second = projectRequest(messages, {
    toolResultBudgetChars: 70,
    replacementState: state,
  })

  assert.deepEqual(second.report.replacedToolUseIds, ['call-2'])
  assert.equal(JSON.stringify(second.messages).includes('a'.repeat(60)), true)
  assert.equal(JSON.stringify(second.messages).includes('call-2 omitted'), true)
})

test('normalization merges adjacent users and hoists tool results', () => {
  const projected = projectRequest(completeToolTurn)
  const toolUser = projected.messages.find(message =>
    message.content.some(block => block.type === 'tool_result'),
  )
  assert.equal(toolUser?.role, 'user')
  assert.equal(toolUser?.content[0]?.type, 'tool_result')
  assert.equal(toolUser?.content.filter(block => block.type === 'tool_result').length, 1)
  assert.equal(toolUser?.content.some(block => block.type === 'text' && block.text === 'branch=main'), true)
})

test('strict pairing rejects a missing tool result', () => {
  const broken = completeToolTurn.filter(message => message.kind !== 'tool-result' && message.kind !== 'attachment')
  assert.throws(() => projectRequest(broken), ProjectionError)
})

test('repair pairing inserts an explicit synthetic error and reports it', () => {
  const broken = completeToolTurn.filter(message => message.kind !== 'tool-result' && message.kind !== 'attachment')
  const projected = projectRequest(broken, { pairing: 'repair' })

  assert.deepEqual(projected.report.repairedMissingToolUseIds, ['call-1'])
  assert.equal(JSON.stringify(projected.messages).includes('missing tool result repaired'), true)
})

test('final provider params are built after projection and deeply frozen', () => {
  const projected = projectRequest(completeToolTurn)
  const params = buildFinalParams(
    'model-test',
    projected,
    [{ name: 'read', input_schema: { type: 'object' } }],
    1024,
  )

  assert.equal(params.stream, true)
  assert.equal(params.messages.length, projected.messages.length)
  assert.equal(Object.isFrozen(params), true)
  assert.equal(Object.isFrozen(params.messages), true)
  assert.equal(Object.isFrozen(params.tools[0]?.input_schema), true)
})
