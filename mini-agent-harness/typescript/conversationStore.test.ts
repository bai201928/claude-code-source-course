import assert from 'node:assert/strict'
import {
  ConversationStore,
  MessageInvariantError,
  RevisionConflictError,
  envelopeId,
  groupAssistantFragments,
  isHumanInput,
  responseId,
  textBlock,
  toolUseBlock,
  toolUseId,
  type AssistantMessage,
  type HumanMessage,
  type ToolResultMessage,
} from './conversationStore.ts'

const human = (id: string, text: string): HumanMessage => ({
  kind: 'human',
  id: envelopeId(id),
  text,
})

const assistant = (
  id: string,
  response: string,
  blocks: AssistantMessage['blocks'],
): AssistantMessage => ({
  kind: 'assistant',
  id: envelopeId(id),
  responseId: responseId(response),
  blocks,
})

const result = (
  id: string,
  useId: string,
  output = 'ok',
): ToolResultMessage => ({
  kind: 'tool-result',
  id: envelopeId(id),
  toolUseId: toolUseId(useId),
  output,
  isError: false,
})

let passed = 0
function test(name: string, body: () => void): void {
  body()
  passed += 1
  console.log(`ok - ${name}`)
}

test('snapshot membership is stable across later appends', () => {
  const store = new ConversationStore()
  const first = store.append(0, [human('m-1', 'first')])
  store.append(1, [human('m-2', 'second')])
  assert.equal(first.revision, 1)
  assert.deepEqual(first.messages.map(item => item.id), ['m-1'])
  assert.deepEqual(store.snapshot().messages.map(item => item.id), ['m-1', 'm-2'])
})

test('one conversation accepts only one runtime owner', () => {
  const store = new ConversationStore()
  const owner = {}
  store.bindRuntime(owner)
  assert.doesNotThrow(() => store.bindRuntime(owner))
  assert.throws(() => store.bindRuntime({}), /already bound to another AgentRuntime/)
})

test('an active run lease rejects external writers and releases cleanly', () => {
  const store = new ConversationStore()
  const owner = {}
  store.bindRuntime(owner)
  const lease = store.acquireRun(owner)
  assert.throws(
    () => store.append(0, [human('external', 'blocked')]),
    /active AgentRuntime run lease/,
  )
  store.append(0, [human('runtime', 'allowed')], lease)
  store.releaseRun(owner, lease)
  assert.doesNotThrow(() => store.append(1, [human('after', 'allowed')]))
})

test('publication clones and freezes nested payloads', () => {
  const input = { path: 'before.txt', options: { lines: [1, 2] } }
  const message = assistant('a-1', 'response-1', [
    toolUseBlock(toolUseId('tool-1'), 'Read', input),
  ])
  const store = new ConversationStore()
  const snapshot = store.append(0, [message])
  input.path = 'after.txt'
  input.options.lines.push(3)
  const block = (snapshot.messages[0] as AssistantMessage).blocks[0]!
  assert.equal(block.kind, 'tool-use')
  if (block.kind !== 'tool-use') throw new Error('expected tool-use block')
  assert.equal(block.input.path, 'before.txt')
  assert.deepEqual((block.input.options as { lines: number[] }).lines, [1, 2])
  assert.equal(Object.isFrozen(block.input), true)
})

test('stale writers fail instead of silently losing an update', () => {
  const store = new ConversationStore()
  const writerA = store.snapshot().revision
  const writerB = store.snapshot().revision
  store.append(writerA, [human('m-a', 'writer A')])
  assert.throws(
    () => store.append(writerB, [human('m-b', 'writer B')]),
    RevisionConflictError,
  )
  assert.deepEqual(store.snapshot().messages.map(item => item.id), ['m-a'])
  assert.equal(store.traces().at(-1)?.status, 'rejected')
})

test('response identity groups fragments without replacing envelope identity', () => {
  const shared = 'provider-response-7'
  const store = new ConversationStore([
    assistant('a-text', shared, [textBlock('working')]),
    assistant('a-tool', shared, [
      toolUseBlock(toolUseId('tool-7'), 'Read', { path: 'a.ts' }),
    ]),
  ])
  const groups = groupAssistantFragments(store.snapshot().messages)
  assert.deepEqual(
    groups.get(responseId(shared))?.map(item => item.id),
    ['a-text', 'a-tool'],
  )
})

test('human input and user-role tool result stay different domain kinds', () => {
  const prompt = human('m-human', 'inspect file')
  const toolResult = result('m-result', 'tool-8')
  assert.equal(isHumanInput(prompt), true)
  assert.equal(isHumanInput(toolResult), false)
})

test('orphan and duplicate tool results fail closed', () => {
  assert.throws(
    () => new ConversationStore([result('orphan', 'missing')]),
    /no matching tool use/,
  )
  const use = assistant('a-use', 'response-use', [
    toolUseBlock(toolUseId('tool-9'), 'Search', { query: 'owner' }),
  ])
  assert.throws(
    () => new ConversationStore([use, result('r-1', 'tool-9'), result('r-2', 'tool-9')]),
    /duplicate tool result/,
  )
})

test('parallel tool uses accept exactly one result each and become request-ready', () => {
  const store = new ConversationStore([
    assistant('a-parallel', 'response-parallel', [
      toolUseBlock(toolUseId('tool-a'), 'Read', { path: 'a' }),
      toolUseBlock(toolUseId('tool-b'), 'Read', { path: 'b' }),
    ]),
    result('r-b', 'tool-b'),
    result('r-a', 'tool-a'),
  ])
  assert.doesNotThrow(() => store.assertRequestReady(store.snapshot()))
})

test('missing or non-adjacent tool results cannot enter a request', () => {
  const missing = new ConversationStore([
    assistant('a-missing', 'response-missing', [
      toolUseBlock(toolUseId('tool-missing'), 'Read', { path: 'x' }),
    ]),
  ])
  assert.throws(() => missing.assertRequestReady(missing.snapshot()), /unresolved/)

  const interrupted = new ConversationStore([
    assistant('a-gap', 'response-gap', [
      toolUseBlock(toolUseId('tool-gap'), 'Read', { path: 'x' }),
    ]),
    human('human-gap', 'new prompt'),
    result('r-gap', 'tool-gap'),
  ])
  assert.throws(
    () => interrupted.assertRequestReady(interrupted.snapshot()),
    /immediately follow/,
  )
})

test('progress is ephemeral and never changes durable revision or membership', () => {
  const store = new ConversationStore([
    assistant('a-progress', 'response-progress', [
      toolUseBlock(toolUseId('tool-progress'), 'Bash', { command: 'build' }),
    ]),
  ])
  const before = store.snapshot()
  const progress = store.publishProgress(
    envelopeId('p-1'),
    toolUseId('tool-progress'),
    '50%',
  )
  const after = store.snapshot()
  assert.equal(progress.sequence, 1)
  assert.equal(after.revision, before.revision)
  assert.equal(after.messages.length, before.messages.length)
  assert.equal(after.messages.some(item => item.id === progress.id), false)
})

test('replace validates parent identity before publishing a new revision', () => {
  const store = new ConversationStore([human('root', 'root')])
  assert.throws(
    () =>
      store.replace(0, [
        {
          ...human('child', 'child'),
          parentId: envelopeId('missing-parent'),
        },
      ]),
    MessageInvariantError,
  )
  assert.deepEqual(store.snapshot().messages.map(item => item.id), ['root'])
})

console.log(`TypeScript conversation store tests: ${passed} passed`)
