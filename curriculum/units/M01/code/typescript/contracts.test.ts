import assert from 'node:assert/strict'
import {
  executeTool,
  parseMessage,
  summarizeMessage,
  transitionRunState,
  weatherTool,
  type HarnessMessage,
  type RunState,
} from './contracts.ts'

let passed = 0

function test(name: string, body: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(body)
    .then(() => {
      passed += 1
      console.log(`ok - ${name}`)
    })
}

await test('discriminant selects the legal fields', () => {
  const message: HarnessMessage = {
    kind: 'user',
    id: 'm-1',
    timestamp: '2026-07-28T00:00:00.000Z',
    content: 'hello',
  }
  assert.equal(summarizeMessage(message), 'user:hello')
})

await test('unknown input is checked at runtime', () => {
  assert.throws(
    () =>
      parseMessage({
        kind: 'user',
        id: 'm-2',
        timestamp: '2026-07-28T00:00:00.000Z',
        blocks: [],
      }),
    /Invalid message variant/,
  )
})

await test('value union does not replace transition validation', () => {
  const terminal: RunState = { kind: 'completed', finalMessageId: 'm-3' }
  assert.throws(
    () => transitionRunState(terminal, { kind: 'running', turn: 2 }),
    /Illegal transition/,
  )
})

await test('generic tool still validates external input', async () => {
  assert.deepEqual(await executeTool(weatherTool, { city: 'Shanghai' }), {
    city: 'Shanghai',
    temperatureC: 31,
  })
  await assert.rejects(() => executeTool(weatherTool, { city: 42 }), /Invalid input/)
})

console.log(`TypeScript M01 contract tests: ${passed} passed`)
