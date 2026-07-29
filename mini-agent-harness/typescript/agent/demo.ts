import path from 'node:path'
import { createAgentApplication, shutdownApplication } from './app.ts'
import { resolveHarnessSettings } from './config.ts'
import { ScriptedModelAdapter } from './testing.ts'
import { MemoryTraceSink } from './trace.ts'

const workspace = path.resolve(import.meta.dirname, '..', '..')
const trace = new MemoryTraceSink()
const model = new ScriptedModelAdapter([
  () => ({
    responseId: 'demo-response-1',
    toolCalls: [{
      id: 'demo-call-1',
      name: 'list_files',
      input: { glob: '*.md', max_results: 10 },
    }],
  }),
  request => {
    const result = request.messages.find(message => message.role === 'tool')
    const count = result?.role === 'tool'
      ? result.content.split(/\r?\n/).filter(Boolean).length
      : 0
    return {
      responseId: 'demo-response-2',
      text: `The tool loop inspected the workspace and observed ${count} Markdown paths.`,
      toolCalls: [],
    }
  },
])
const application = createAgentApplication({
  settings: resolveHarnessSettings({}, { workspace, model: model.model }),
  credential: { apiKey: 'unused-scripted-credential', source: 'environment' },
  mode: 'headless',
  traceSinks: [trace],
  runtimeOverrides: { model },
})

try {
  const summary = await application.runtime.submit(
    'Inspect the Markdown files in this harness.',
    new AbortController().signal,
  )
  console.log(JSON.stringify({ summary, traceEvents: trace.events.length }, null, 2))
} finally {
  await shutdownApplication(application, 'demo-finished', 0)
}

