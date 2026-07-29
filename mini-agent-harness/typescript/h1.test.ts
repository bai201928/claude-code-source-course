import assert from 'node:assert/strict'
import { H0Harness, type HarnessMessage } from './h0.ts'
import {
  H0RuntimeCore,
  HeadlessSurface,
  InteractiveSurface,
  type DomainEvent,
  type RuntimeCommand,
  type RuntimeCore,
} from './h1.ts'

let passed = 0
async function test(name: string, body: () => Promise<void>): Promise<void> {
  await body()
  passed += 1
  console.log(`ok - ${name}`)
}

function createHarness(
  query: (prompt: string) => AsyncIterable<HarnessMessage> = async function* (prompt) {
    yield { kind: 'progress', text: `working:${prompt}` }
    yield { kind: 'assistant', text: `done:${prompt}` }
  },
): H0Harness {
  return new H0Harness(
    async prompt => ({
      messages: [{ kind: 'user', text: prompt }],
      shouldQuery: true,
    }),
    async function* (messages) {
      const prompt = messages.at(-1)?.text ?? ''
      yield* query(prompt)
    },
  )
}

await test('H0 core is reused behind the surface boundary', async () => {
  let harnesses = 0
  const core = new H0RuntimeCore(() => {
    harnesses += 1
    return createHarness()
  })
  const run = await new InteractiveSurface(core).submit('hello')
  assert.equal(harnesses, 1)
  assert.deepEqual(run.events, [
    { type: 'progress', text: 'working:hello' },
    { type: 'result', text: 'done:hello' },
  ])
})

await test('interactive and headless preserve the same core events', async () => {
  const interactive = await new InteractiveSurface(
    new H0RuntimeCore(() => createHarness()),
  ).submit('hello')
  const headless = await new HeadlessSurface(
    new H0RuntimeCore(() => createHarness()),
  ).submit('hello', { inputFormat: 'text', outputFormat: 'stream-json' })
  assert.deepEqual(interactive.events, headless.events)
})

await test('headless formats change projection rather than core events', async () => {
  const run = async (outputFormat: 'text' | 'json' | 'stream-json') =>
    new HeadlessSurface(new H0RuntimeCore(() => createHarness())).submit('hello', {
      inputFormat: 'text',
      outputFormat,
    })
  const text = await run('text')
  const json = await run('json')
  const stream = await run('stream-json')
  assert.deepEqual(text.output, ['done:hello'])
  assert.equal(JSON.parse(json.output[0]!).events.length, 2)
  assert.ok(stream.output.every(line => line.endsWith('\n')))
  assert.deepEqual(text.events, json.events)
  assert.deepEqual(json.events, stream.events)
})

await test('invalid NDJSON is rejected before an H0 harness is created', async () => {
  let harnesses = 0
  const surface = new HeadlessSurface(
    new H0RuntimeCore(() => {
      harnesses += 1
      return createHarness()
    }),
  )
  await assert.rejects(
    () =>
      surface.submit('{bad json}', {
        inputFormat: 'stream-json',
        outputFormat: 'stream-json',
      }),
    /invalid NDJSON/,
  )
  assert.equal(harnesses, 0)
})

await test('multiple NDJSON messages preserve command order', async () => {
  const prompts: string[] = []
  const surface = new HeadlessSurface(
    new H0RuntimeCore(() =>
      createHarness(async function* (prompt) {
        prompts.push(prompt)
        yield { kind: 'assistant', text: `done:${prompt}` }
      }),
    ),
  )
  const line = (text: string) =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
  await surface.submit(`${line('one')}\n${line('two')}\n`, {
    inputFormat: 'stream-json',
    outputFormat: 'stream-json',
  })
  assert.deepEqual(prompts, ['one', 'two'])
})

await test('H0 failure becomes an explicit surface event', async () => {
  const core = new H0RuntimeCore(() =>
    createHarness(async function* () {
      yield { kind: 'progress', text: 'partial' }
      throw new Error('model failed')
    }),
  )
  const run = await new HeadlessSurface(core).submit('hello', {
    inputFormat: 'text',
    outputFormat: 'text',
  })
  assert.deepEqual(run.events, [
    { type: 'progress', text: 'partial' },
    { type: 'failure', message: 'model failed' },
  ])
  assert.deepEqual(run.output, ['Execution error: model failed'])
})

await test('closed surface rejects input without creating a harness', async () => {
  let harnesses = 0
  const surface = new InteractiveSurface(
    new H0RuntimeCore(() => {
      harnesses += 1
      return createHarness()
    }),
  )
  surface.close()
  await assert.rejects(() => surface.submit('late'), /surface is closed/)
  assert.equal(harnesses, 0)
})

await test('unknown runtime events fail at the projection boundary', async () => {
  const invalidCore: RuntimeCore = {
    async *run(_command: RuntimeCommand) {
      yield { type: 'future-event', value: 1 } as unknown as DomainEvent
    },
  }
  await assert.rejects(
    () =>
      new HeadlessSurface(invalidCore).submit('hello', {
        inputFormat: 'text',
        outputFormat: 'text',
      }),
    /unknown surface value/,
  )
})

console.log(`TypeScript H1 tests: ${passed} passed`)
