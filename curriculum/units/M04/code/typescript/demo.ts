import { collect, TraceableEngine, type HarnessMessage } from './traceHarness.ts'

const engine = new TraceableEngine(
  [],
  async prompt => ({
    messages: [{ kind: 'user', text: prompt }],
    shouldQuery: true,
  }),
  async function* (): AsyncGenerator<HarnessMessage> {
    yield { kind: 'assistant', text: 'first observable answer' }
  },
)

const output = await collect(engine.submitMessage('trace this turn'))
console.log(JSON.stringify({ output, state: engine.getMessages(), trace: engine.trace.events }, null, 2))
