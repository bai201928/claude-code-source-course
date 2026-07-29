import { H0Harness, type HarnessMessage } from './h0.ts'

const harness = new H0Harness(
  async prompt => ({
    messages: [{ kind: 'user', text: prompt }],
    shouldQuery: true,
  }),
  async function* (): AsyncGenerator<HarnessMessage> {
    yield { kind: 'progress', text: 'thinking' }
    yield { kind: 'assistant', text: 'H0 ready' }
  },
)

const output: HarnessMessage[] = []
for await (const message of harness.run('build a traceable run')) output.push(message)
console.log(JSON.stringify({ output, state: harness.state, trace: harness.trace.events }, null, 2))
