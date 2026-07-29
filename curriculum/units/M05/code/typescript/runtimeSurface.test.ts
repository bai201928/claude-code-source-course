import assert from 'node:assert/strict'
import {
  HeadlessSurface,
  InteractiveSurface,
  type DomainEvent,
  type RuntimeCommand,
  type RuntimeCore,
} from './runtimeSurface.ts'

class ScriptedCore implements RuntimeCore {
  readonly commands: RuntimeCommand[] = []

  async *run(command: RuntimeCommand): AsyncGenerator<DomainEvent> {
    this.commands.push(command)
    yield { type: 'progress', text: `working:${command.text}` }
    yield { type: 'result', text: `done:${command.text}` }
  }
}

let passed = 0
async function test(name: string, body: () => Promise<void>): Promise<void> {
  await body()
  passed += 1
  console.log(`ok - ${name}`)
}

await test('interactive and headless drive the same core event contract', async () => {
  const interactive = new InteractiveSurface(new ScriptedCore())
  const headless = new HeadlessSurface(new ScriptedCore())
  const a = await interactive.submit('hello')
  const b = await headless.submit('hello', {
    inputFormat: 'text',
    outputFormat: 'stream-json',
  })
  assert.deepEqual(a.events, b.events)
  assert.deepEqual(a.events.map(event => event.type), ['progress', 'result'])
})

await test('interactive surface stays open across prompts', async () => {
  const core = new ScriptedCore()
  const surface = new InteractiveSurface(core)
  assert.deepEqual((await surface.submit('one')).output, [
    'status: working:one',
    'assistant: done:one',
  ])
  assert.deepEqual((await surface.submit('two')).output, [
    'status: working:two',
    'assistant: done:two',
  ])
  assert.equal(core.commands.length, 2)
})

await test('headless formats only change output projection', async () => {
  const text = await new HeadlessSurface(new ScriptedCore()).submit('hello', {
    inputFormat: 'text',
    outputFormat: 'text',
  })
  const json = await new HeadlessSurface(new ScriptedCore()).submit('hello', {
    inputFormat: 'text',
    outputFormat: 'json',
  })
  const stream = await new HeadlessSurface(new ScriptedCore()).submit('hello', {
    inputFormat: 'text',
    outputFormat: 'stream-json',
  })
  assert.deepEqual(text.output, ['done:hello'])
  assert.equal(JSON.parse(json.output[0]!).events.length, 2)
  assert.equal(stream.output.length, 2)
  assert.ok(stream.output.every(line => line.endsWith('\n')))
  assert.ok(stream.output.every(line => line.trim().split('\n').length === 1))
  assert.deepEqual(text.events, json.events)
  assert.deepEqual(json.events, stream.events)
})

await test('invalid NDJSON is rejected before core is called', async () => {
  const core = new ScriptedCore()
  const surface = new HeadlessSurface(core)
  await assert.rejects(
    () =>
      surface.submit('{bad json}', {
        inputFormat: 'stream-json',
        outputFormat: 'stream-json',
      }),
    /invalid NDJSON/,
  )
  assert.equal(core.commands.length, 0)
  assert.ok(surface.trace.events.some(event => event.type === 'input.rejected'))
})

await test('multiple NDJSON user lines preserve command order', async () => {
  const core = new ScriptedCore()
  const surface = new HeadlessSurface(core)
  const line = (text: string) =>
    JSON.stringify({ type: 'user', message: { role: 'user', content: text } })
  const run = await surface.submit(`${line('one')}\n${line('two')}\n`, {
    inputFormat: 'stream-json',
    outputFormat: 'stream-json',
  })
  assert.deepEqual(core.commands.map(command => command.text), ['one', 'two'])
  assert.deepEqual(run.events.map(event => event.type), [
    'progress',
    'result',
    'progress',
    'result',
  ])
})

await test('closing a surface rejects new input without a fake result', async () => {
  const core = new ScriptedCore()
  const surface = new InteractiveSurface(core)
  surface.close()
  await assert.rejects(() => surface.submit('late'), /surface is closed/)
  assert.equal(core.commands.length, 0)
  assert.deepEqual(surface.trace.events.map(event => event.type), ['surface.closed'])
})

await test('unknown runtime event fails explicitly at the adapter boundary', async () => {
  const invalidCore: RuntimeCore = {
    async *run() {
      yield { type: 'future-event', value: 1 } as unknown as DomainEvent
    },
  }
  const surface = new HeadlessSurface(invalidCore)
  await assert.rejects(
    () =>
      surface.submit('hello', {
        inputFormat: 'text',
        outputFormat: 'text',
      }),
    /unknown surface value/,
  )
})

console.log(`TypeScript M05 tests: ${passed} passed`)

