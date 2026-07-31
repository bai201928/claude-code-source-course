import assert from 'node:assert/strict'
import test from 'node:test'
import { ExtensionDecisionPipeline, type DecisionEvidence } from './extensionDecision.ts'
import type { PermissionGate } from './permissions.ts'
import { AgentToolRegistry, type AgentTool } from './tools.ts'

const allowGate: PermissionGate = {
  decide: () => ({ allowed: true, reason: 'policy-allow' }),
}

test('hook allow remains subordinate to a policy deny and keeps both evidence items', async () => {
  const pipeline = new ExtensionDecisionPipeline({
    preHooks: [{ id: 'advisory', run: () => ({ behavior: 'allow' }) }],
  })
  const prepared = await pipeline.prepare(basePrepare({
    pipeline,
    gate: { decide: () => ({ allowed: false, reason: 'policy-deny' }) },
  }))
  assert.equal(prepared.decision.allowed, false)
  assert.deepEqual(prepared.evidence.map(item => [item.stage, item.behavior]), [
    ['pre-hook', 'allow'],
    ['policy', 'deny'],
  ])
})

test('ordered rewrite is revalidated before a handler can run', async () => {
  let calls = 0
  const pipeline = new ExtensionDecisionPipeline({
    preHooks: [{ id: 'rewrite', run: () => ({ updatedInput: { count: 0 } }) }],
  })
  const registry = registryWith(pipeline, async () => { calls++; return 'side-effect' })
  await assert.rejects(
    registry.dispatch('demo', { count: 2 }, context(), allowGate, new Set(['demo']), 'call-1'),
    /count must be positive/,
  )
  assert.equal(calls, 0)
})

test('final abort gate blocks the side effect after permission resolution', async () => {
  let calls = 0
  const controller = new AbortController()
  const gate: PermissionGate = {
    decide: () => {
      queueMicrotask(() => controller.abort(new Error('cancelled after allow')))
      return { allowed: true, reason: 'policy-allow' }
    },
  }
  const registry = registryWith(new ExtensionDecisionPipeline(), async () => { calls++; return 'bad' })
  await assert.rejects(
    registry.dispatch('demo', { count: 2 }, context(controller.signal), gate, new Set(['demo']), 'call-2'),
    /cancelled after allow/,
  )
  assert.equal(calls, 0)
})

test('post hook can stop continuation but cannot roll back a completed side effect', async () => {
  let calls = 0
  const pipeline = new ExtensionDecisionPipeline({
    postHooks: [{ id: 'stop-after', run: () => ({ blockContinuation: true }) }],
  })
  const result = await registryWith(pipeline, async () => { calls++; return 'done' }).dispatch(
    'demo', { count: 2 }, context(), allowGate, new Set(['demo']), 'call-3',
  )
  assert.equal(calls, 1)
  assert.equal(result.output, 'done')
  assert.equal(result.continueConversation, false)
})

test('headless ask without a resolver and resolver failure both fail closed', async () => {
  for (const pipeline of [
    new ExtensionDecisionPipeline({
      preHooks: [{ id: 'ask', run: () => ({ behavior: 'ask' }) }],
    }),
    new ExtensionDecisionPipeline({
      preHooks: [{ id: 'ask', run: () => ({ behavior: 'ask' }) }],
      askResolver: () => { throw new Error('resolver unavailable') },
    }),
  ]) {
    const prepared = await pipeline.prepare(basePrepare({ pipeline, gate: allowGate }))
    assert.equal(prepared.decision.allowed, false)
  }
})

test('decision evidence is metadata-only', async () => {
  const pipeline = new ExtensionDecisionPipeline({
    preHooks: [{ id: 'rewrite', run: () => ({ updatedInput: { count: 3 }, behavior: 'allow' }) }],
  })
  const result = await registryWith(pipeline, async () => ({ secret: 'not-in-evidence' })).dispatch(
    'demo', { count: 2, secret: 'input-secret' }, context(), allowGate, new Set(['demo']), 'call-4',
  )
  assertMetadataOnly(result.decisionEvidence)
  assert.equal(JSON.stringify(result.decisionEvidence).includes('secret'), false)
})

test('resolver rewrite creates a revision, revalidates and reruns policy', async () => {
  let policyCalls = 0
  const pipeline = new ExtensionDecisionPipeline({
    preHooks: [{ id: 'ask', run: () => ({ behavior: 'ask' }) }],
    askResolver: () => ({
      allowed: true,
      reason: 'human-approved',
      updatedInput: { count: 4 },
    }),
  })
  const prepared = await pipeline.prepare({
    ...basePrepare({ pipeline, gate: allowGate }),
    gate: {
      decide: () => {
        policyCalls++
        return { allowed: true, reason: 'content-bearing-reason-must-not-enter-evidence' }
      },
    },
  })
  assert.equal(prepared.context.revision, 1)
  assert.equal(prepared.context.input.count, 4)
  assert.equal(policyCalls, 2)
  assert.equal(JSON.stringify(prepared.evidence).includes('content-bearing'), false)
})

function basePrepare(input: { pipeline: ExtensionDecisionPipeline; gate: PermissionGate }) {
  return {
    callId: 'call',
    toolName: 'demo',
    input: { count: 2 },
    validateSchema: () => {},
    validateSemantics: (candidate: Readonly<Record<string, unknown>>) => {
      if (candidate.count === 0) throw new Error('count must be positive')
    },
    permissionRequest: () => ({ toolName: 'demo', risk: 'read' as const }),
    gate: input.gate,
    signal: new AbortController().signal,
  }
}

function registryWith(
  pipeline: ExtensionDecisionPipeline,
  execute: AgentTool['execute'],
): AgentToolRegistry {
  const registry = new AgentToolRegistry(pipeline)
  registry.register({
    name: 'demo',
    description: 'test tool',
    inputSchema: { type: 'object', properties: { count: { type: 'integer' }, secret: { type: 'string' } }, required: ['count'], additionalProperties: false },
    risk: 'read',
    permissionRequest: () => ({ toolName: 'demo', risk: 'read' }),
    validateInput: input => {
      if (typeof input.count !== 'number' || input.count <= 0) throw new Error('count must be positive')
    },
    execute,
  })
  return registry
}

function context(signal = new AbortController().signal) {
  return { workspace: process.cwd(), signal }
}

function assertMetadataOnly(evidence: readonly DecisionEvidence[]): void {
  const allowed = new Set(['stage', 'sourceId', 'behavior', 'revision'])
  for (const item of evidence) {
    assert.deepEqual(Object.keys(item).sort(), [...allowed].sort())
  }
}
