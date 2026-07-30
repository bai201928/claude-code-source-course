import assert from 'node:assert/strict'
import test from 'node:test'
import {
  Scheduler,
  compareSnapshotPolicies,
  type Call,
  type Tool,
} from './tool-scheduler.ts'

test('safe A and B share a batch; unsafe C is a barrier; safe D follows it', () => {
  const scheduler = new Scheduler([
    makeTool('A', true), makeTool('B', true), makeTool('C', false), makeTool('D', true),
  ])
  assert.deepEqual(
    scheduler.plan(['A', 'B', 'C', 'D'].map(call)).map(batch => [batch.mode, batch.calls.map(item => item.name)]),
    [['concurrent', ['A', 'B']], ['exclusive', ['C']], ['concurrent', ['D']]],
  )
})

test('bounded workers preserve barriers while outcomes stay in call order', async () => {
  let active = 0
  let peak = 0
  const timeline: string[] = []
  const tools = [
    makeTool('A', true, 30), makeTool('B', true, 5),
    makeTool('C', false, 5), makeTool('D', true, 1),
  ].map(tool => ({
    ...tool,
    async run(input: Readonly<Record<string, unknown>>, report: (stage: string) => void, signal: AbortSignal) {
      active++
      peak = Math.max(peak, active)
      timeline.push(`start:${tool.name}`)
      const result = await tool.run(input, report, signal)
      timeline.push(`end:${tool.name}`)
      active--
      return result
    },
  }))
  const result = await new Scheduler(tools, 2).execute(
    ['A', 'B', 'C', 'D'].map(call), new AbortController().signal,
  )
  assert.equal(peak, 2)
  assert.ok(timeline.indexOf('start:C') > timeline.indexOf('end:A'))
  assert.ok(timeline.indexOf('start:D') > timeline.indexOf('end:C'))
  assert.deepEqual(result.outcomes.map(outcome => outcome.callId), ['id-A', 'id-B', 'id-C', 'id-D'])
})

test('schema failure happens before dynamic safety classification', async () => {
  let classified = false
  let executed = false
  const invalid: Tool = {
    ...makeTool('invalid', true),
    parse() { throw new Error('count must be an integer') },
    isConcurrencySafe() { classified = true; return true },
    async run() { executed = true; return { output: 'bad' } },
  }
  const result = await new Scheduler([invalid]).execute(
    [call('invalid')], new AbortController().signal,
  )
  assert.equal(classified, false)
  assert.equal(executed, false)
  assert.equal(result.outcomes[0]?.status, 'error')
})

test('deny, throw and cancel each keep exactly one result per id', async () => {
  const controller = new AbortController()
  const denied = { ...makeTool('denied', false), permission: () => 'deny' as const }
  const thrown = { ...makeTool('thrown', true), run: async () => { throw new Error('boom') } }
  const cancelling = {
    ...makeTool('cancel', true),
    run: async () => { controller.abort(new Error('stop')); throw new Error('stop') },
  }
  const calls = ['denied', 'thrown', 'cancel', 'later'].map(call)
  const result = await new Scheduler([denied, thrown, cancelling, makeTool('later', true)], 1)
    .execute(calls, controller.signal)
  assert.deepEqual(result.outcomes.map(outcome => outcome.status), [
    'denied', 'error', 'cancelled', 'cancelled',
  ])
  assert.equal(new Set(result.outcomes.map(outcome => outcome.callId)).size, calls.length)
})

test('progress precedes final outcome and context follows original block order', async () => {
  const timeline: string[] = []
  const slow = makeTool('slow', true, 20, { winner: 'slow' })
  const fast = {
    ...makeTool('fast', true, 1, { winner: 'fast' }),
    async run(input: Readonly<Record<string, unknown>>, report: (stage: string) => void, signal: AbortSignal) {
      report('half')
      return makeTool('fast', true, 1, { winner: 'fast' }).run(input, report, signal)
    },
  }
  const result = await new Scheduler([slow, fast]).execute(
    [call('slow'), call('fast')],
    new AbortController().signal,
    progress => timeline.push(`progress:${progress.callId}`),
  )
  timeline.push('result')
  assert.deepEqual(timeline, ['progress:id-fast', 'result'])
  assert.equal(result.context.winner, 'fast')
})

test('snapshot paths differ for concurrent context modifiers', () => {
  const comparison = compareSnapshotPolicies([
    { id: 'A', safe: true, update: { safe: 'kept-only-after-response' } },
    { id: 'C', safe: false, update: { exclusive: 'kept-in-both' } },
  ])
  assert.deepEqual(comparison.responseCompleteContext, {
    safe: 'kept-only-after-response', exclusive: 'kept-in-both',
  })
  assert.deepEqual(comparison.streamingContext, { exclusive: 'kept-in-both' })
})

function call(name: string): Call {
  return { id: `id-${name}`, name, input: {} }
}

function makeTool(
  name: string,
  safe: boolean,
  delay = 0,
  update?: Readonly<Record<string, string>>,
): Tool {
  return {
    name,
    parse: input => input,
    isConcurrencySafe: () => safe,
    permission: () => 'allow',
    async run(_input, _report, signal) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      if (signal.aborted) throw signal.reason
      return { output: name, ...(update ? { update } : {}) }
    },
  }
}
