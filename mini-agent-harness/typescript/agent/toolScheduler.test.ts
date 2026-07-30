import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelToolCall } from './model.ts'
import { PolicyPermissionGate } from './permissions.ts'
import { ToolScheduler } from './toolScheduler.ts'
import { AgentToolRegistry, type AgentTool, type ToolContext } from './tools.ts'

test('plans concurrent safe batches around exclusive barriers', async () => {
  const timeline: string[] = []
  const releases = new Map<string, () => void>()
  const started = new Map<string, Promise<void>>()
  const registry = new AgentToolRegistry()
  for (const [name, safe] of [['A', true], ['B', true], ['C', false], ['D', true]] as const) {
    let markStarted!: () => void
    started.set(name, new Promise<void>(resolve => { markStarted = resolve }))
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    releases.set(name, release)
    registry.register(tool(name, safe, async () => {
      timeline.push(`start:${name}`)
      markStarted()
      await blocked
      timeline.push(`end:${name}`)
      return name
    }))
  }
  const scheduler = new ToolScheduler(registry, 2)
  const calls = ['A', 'B', 'C', 'D'].map(call)
  const visible = new Set(['A', 'B', 'C', 'D'])
  const plan = scheduler.plan(calls, visible)

  assert.deepEqual(plan.batches.map(batch => [batch.mode, batch.calls.map(item => item.name)]), [
    ['concurrent', ['A', 'B']],
    ['exclusive', ['C']],
    ['concurrent', ['D']],
  ])

  const pending = scheduler.execute(plan, options(visible))
  await Promise.all([started.get('A'), started.get('B')])
  assert.equal(timeline.includes('start:C'), false)
  releases.get('B')!()
  releases.get('A')!()
  await started.get('C')
  assert.equal(timeline.includes('start:D'), false)
  releases.get('C')!()
  await started.get('D')
  releases.get('D')!()
  const result = await pending

  assert.deepEqual(result.outcomes.map(outcome => outcome.call.id), ['call-A', 'call-B', 'call-C', 'call-D'])
})

test('bounds concurrency and applies context updates in original call order', async () => {
  let active = 0
  let peak = 0
  const registry = new AgentToolRegistry()
  for (const [name, delay] of [['A', 30], ['B', 5], ['D', 5]] as const) {
    registry.register(tool(name, true, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, delay))
      active--
      return name
    }, { contextUpdate: () => ({ winner: name }) }))
  }
  const scheduler = new ToolScheduler(registry, 2)
  const visible = new Set(['A', 'B', 'D'])
  const result = await scheduler.execute(
    scheduler.plan(['A', 'B', 'D'].map(call), visible),
    options(visible),
  )

  assert.equal(peak, 2)
  assert.deepEqual(result.outcomes.map(outcome => outcome.output), ['A', 'B', 'D'])
  assert.equal(result.context.winner, 'D')
})

test('invalid, denied and thrown calls each produce one paired outcome', async () => {
  let classified = false
  let invalidExecuted = false
  const registry = new AgentToolRegistry()
  registry.register({
    ...tool('invalid', true, async () => { invalidExecuted = true; return 'bad' }),
    inputSchema: {
      type: 'object',
      properties: { count: { type: 'integer' } },
      required: ['count'],
      additionalProperties: false,
    },
    isConcurrencySafe: () => { classified = true; return true },
  })
  registry.register(tool('denied', false, async () => 'bad', {
    risk: 'execute',
    permissionRequest: () => ({ toolName: 'denied', risk: 'execute', command: 'denied' }),
  }))
  registry.register(tool('throws', true, async () => { throw new Error('boom') }))
  const visible = new Set(['invalid', 'denied', 'throws'])
  const scheduler = new ToolScheduler(registry, 2)
  const calls = [
    { id: 'invalid-id', name: 'invalid', input: { count: 'x' } },
    { id: 'denied-id', name: 'denied', input: {} },
    { id: 'throw-id', name: 'throws', input: {} },
  ] satisfies readonly ModelToolCall[]
  const result = await scheduler.execute(scheduler.plan(calls, visible), options(visible))

  assert.equal(classified, false)
  assert.equal(invalidExecuted, false)
  assert.deepEqual(result.outcomes.map(outcome => outcome.status), ['error', 'denied', 'error'])
  assert.equal(new Set(result.outcomes.map(outcome => outcome.call.id)).size, 3)
})

test('progress is observable before the final result', async () => {
  const timeline: string[] = []
  const registry = new AgentToolRegistry()
  registry.register(tool('progressive', true, async (_input, context) => {
    await context.reportProgress?.({ stage: 'half', completed: 1, total: 2 })
    timeline.push('execute:end')
    return 'done'
  }))
  const scheduler = new ToolScheduler(registry)
  const visible = new Set(['progressive'])
  const result = await scheduler.execute(scheduler.plan([call('progressive')], visible), {
    ...options(visible),
    hooks: {
      progress: (_call, progress) => { timeline.push(`progress:${progress.stage}`) },
    },
  })
  timeline.push(`result:${result.outcomes[0]!.status}`)

  assert.deepEqual(timeline, ['progress:half', 'execute:end', 'result:success'])
})

test('cancellation still returns exactly one outcome for every call id', async () => {
  const controller = new AbortController()
  const registry = new AgentToolRegistry()
  registry.register(tool('cancel', true, async () => {
    controller.abort(new Error('cancel now'))
    throw new Error('cancel now')
  }))
  registry.register(tool('later', true, async () => 'must not be committed as success'))
  registry.register(tool('barrier', false, async () => 'must not start'))
  const visible = new Set(['cancel', 'later', 'barrier'])
  const scheduler = new ToolScheduler(registry, 1)
  const calls = ['cancel', 'later', 'barrier'].map(call)
  const result = await scheduler.execute(scheduler.plan(calls, visible), {
    ...options(visible),
    signal: controller.signal,
  })

  assert.deepEqual(result.outcomes.map(outcome => outcome.status), [
    'cancelled', 'cancelled', 'cancelled',
  ])
  assert.equal(new Set(result.outcomes.map(outcome => outcome.call.id)).size, calls.length)
})

function call(name: string): ModelToolCall {
  return Object.freeze({ id: `call-${name}`, name, input: Object.freeze({}) })
}

function tool(
  name: string,
  safe: boolean,
  execute: (input: Readonly<Record<string, unknown>>, context: ToolContext) => Promise<unknown>,
  overrides: Partial<AgentTool> = {},
): AgentTool {
  return Object.freeze({
    name,
    description: name,
    inputSchema: { type: 'object' },
    risk: 'read',
    isConcurrencySafe: () => safe,
    permissionRequest: () => ({ toolName: name, risk: 'read' as const }),
    execute,
    ...overrides,
  })
}

function options(visibleNames: ReadonlySet<string>) {
  return {
    workspace: process.cwd(),
    signal: new AbortController().signal,
    gate: new PolicyPermissionGate(),
    visibleNames,
  }
}
