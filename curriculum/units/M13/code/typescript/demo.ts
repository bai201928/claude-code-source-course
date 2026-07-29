import { buildFinalParams, projectRequest, type DomainMessage } from './request-projection.ts'

const history: readonly DomainMessage[] = [
  { kind: 'human', id: 'u-old', text: 'old turn' },
  { kind: 'compact-boundary', id: 'boundary-1' },
  { kind: 'human', id: 'u-new', text: 'summarize the file' },
  {
    kind: 'assistant',
    id: 'a-1',
    responseId: 'response-1',
    blocks: [{ kind: 'tool-use', id: 'call-1', name: 'read', input: { path: 'README.md' } }],
  },
  { kind: 'tool-result', id: 'tr-1', toolUseId: 'call-1', output: 'A'.repeat(96) },
]

const projection = projectRequest(history, {
  userContext: 'cwd=/workspace',
  toolResultBudgetChars: 32,
})
const params = buildFinalParams(
  'demo-model',
  projection,
  [{ name: 'read', input_schema: { type: 'object' } }],
  512,
)

console.log(JSON.stringify({ sourceCount: history.length, report: projection.report, params }, null, 2))

