import {
  ConversationStore,
  envelopeId,
  responseId,
  textBlock,
  toolUseBlock,
  toolUseId,
} from './conversation-store.ts'

const readId = toolUseId('tool-read-1')
const store = new ConversationStore()

store.append(0, [
  {
    kind: 'human',
    id: envelopeId('user-1'),
    text: 'Read package.json',
  },
  {
    kind: 'assistant',
    id: envelopeId('assistant-text-1'),
    responseId: responseId('provider-response-1'),
    blocks: [textBlock('I will inspect it.')],
  },
  {
    kind: 'assistant',
    id: envelopeId('assistant-tool-1'),
    responseId: responseId('provider-response-1'),
    blocks: [toolUseBlock(readId, 'Read', { path: 'package.json' })],
  },
])

const turnView = store.snapshot()
const progress = store.publishProgress(
  envelopeId('progress-1'),
  readId,
  'reading',
)
store.append(turnView.revision, [
  {
    kind: 'tool-result',
    id: envelopeId('result-1'),
    toolUseId: readId,
    output: '{"name":"demo"}',
    isError: false,
  },
])

store.assertRequestReady(store.snapshot())

console.log(
  JSON.stringify(
    {
      turnViewRevision: turnView.revision,
      turnViewIds: turnView.messages.map(item => item.id),
      progress,
      durableRevision: store.revision,
      durableIds: store.snapshot().messages.map(item => item.id),
      trace: store.traces(),
    },
    null,
    2,
  ),
)
