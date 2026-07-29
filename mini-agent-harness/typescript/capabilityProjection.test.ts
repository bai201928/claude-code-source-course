import assert from 'node:assert/strict'
import {
  CapabilityCatalog,
  CapabilityProjector,
  ExecutableRegistry,
  SystemContextBuilder,
} from './capabilityProjection.ts'

let passed = 0
function test(name: string, body: () => void): void {
  body()
  passed += 1
  console.log(`ok - ${name}`)
}

const read = { name: 'Read', description: 'Read', source: 'builtin' as const, priority: 100 }
const projection = (boundary: string) => ({
  boundary,
  mode: 'default',
  provider: 'first-party',
  model: 'large',
})

test('catalog priority resolves one active definition', () => {
  const catalog = new CapabilityCatalog()
  const value = catalog.publish([
    { ...read, source: 'plugin', priority: 10 },
    read,
  ])
  assert.equal(value.capabilities.length, 1)
  assert.equal(value.capabilities[0]?.source, 'builtin')
})

test('policy visibility and executable registration stay separate', () => {
  const catalog = new CapabilityCatalog()
  const registry = new ExecutableRegistry()
  registry.register('Read', () => 'read')
  registry.register('Deploy', () => 'deploy')
  const snapshot = new CapabilityProjector().project(
    catalog.publish([
      read,
      { name: 'Deploy', description: 'Deploy', source: 'plugin', priority: 50 },
    ]),
    { ...projection('request-1'), policyHiddenNames: new Set(['Deploy']) },
  )
  assert.deepEqual(snapshot.schemas.map(item => item.name), ['Read'])
  assert.deepEqual(registry.names(), ['Deploy', 'Read'])
  assert.deepEqual(
    [snapshot.boundary, snapshot.mode, snapshot.provider, snapshot.model],
    ['request-1', 'default', 'first-party', 'large'],
  )
})

test('new catalog revision cannot mutate an old request snapshot', () => {
  const catalog = new CapabilityCatalog()
  const projector = new CapabilityProjector()
  const first = projector.project(catalog.publish([read]), projection('iteration-1'))
  const second = projector.project(
    catalog.publish([{ name: 'Search', description: 'Search', source: 'mcp', priority: 40 }]),
    projection('iteration-2'),
  )
  assert.equal(first.catalogRevision, 1)
  assert.deepEqual(first.schemas.map(item => item.name), ['Read'])
  assert.equal(second.catalogRevision, 2)
  assert.deepEqual(second.schemas.map(item => item.name), ['Read', 'Search'])
})

test('deferred executable requires discovery before model projection', () => {
  const catalog = new CapabilityCatalog()
  const revision = catalog.publish([
    read,
    { name: 'Search', description: 'Search', source: 'mcp', priority: 40, deferred: true },
  ])
  const projector = new CapabilityProjector()
  const before = projector.project(revision, projection('before'))
  const after = projector.project(revision, {
    ...projection('after'),
    discoveredDeferredNames: new Set(['Search']),
  })
  assert.deepEqual(before.schemas.map(item => item.name), ['Read'])
  assert.deepEqual(after.schemas.map(item => item.name), ['Read', 'Search'])
})

test('visible but unregistered dispatch fails closed', () => {
  const snapshot = new CapabilityProjector().project(
    new CapabilityCatalog().publish([
      { name: 'Ghost', description: 'Ghost', source: 'dynamic', priority: 1 },
    ]),
    projection('divergent'),
  )
  assert.throws(
    () => new ExecutableRegistry().dispatch(snapshot, 'Ghost', {}),
    /visible tool has no executable handler/,
  )
})

test('custom prompt replaces default and append remains separate', () => {
  const result = new SystemContextBuilder().build({
    defaultPrompt: ['default'],
    customPrompt: 'custom',
    appendPrompt: 'policy',
    userContext: { claudeMd: 'rules' },
    systemContext: { cwd: 'D:/work' },
  })
  assert.deepEqual(result.systemPrompt, ['custom', 'policy'])
  assert.equal(result.base, 'custom')
  assert.equal(result.metaUserContext.claudeMd, 'rules')
})

console.log(`TypeScript harness capability tests: ${passed} passed`)
