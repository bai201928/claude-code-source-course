import {
  ResultBudgetLedger,
  applyPerResultPreview,
  projectAndCommit,
  totalToolResultChars,
  type Envelope,
} from './context-budget.ts'

const source: Envelope[] = [
  { kind: 'assistant', responseId: 'response-demo', calls: [
    { id: 'search-a', name: 'search' },
    { id: 'search-b', name: 'search' },
    { id: 'search-c', name: 'search' },
  ] },
  { kind: 'tool-result', callId: 'search-a', content: 'A'.repeat(80) },
  { kind: 'progress', callId: 'search-b', text: 'halfway' },
  { kind: 'tool-result', callId: 'search-b', content: 'B'.repeat(80) },
  { kind: 'attachment', text: 'workspace changed' },
  { kind: 'tool-result', callId: 'search-c', content: 'C'.repeat(80) },
]

const perResult = applyPerResultPreview(source, 100, 4)
const aggregate = projectAndCommit(source, new ResultBudgetLedger(), {
  maxGroupChars: 190,
  previewChars: 4,
})

console.log({
  durableChars: totalToolResultChars(source),
  perResultChars: totalToolResultChars(perResult),
  aggregateChars: totalToolResultChars(aggregate.messages),
  report: aggregate.report,
})
