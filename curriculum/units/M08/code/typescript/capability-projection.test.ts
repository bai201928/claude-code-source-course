import assert from 'node:assert/strict'
import {
  CapabilityCatalog,
  CapabilityProjector,
  ExecutableRegistry,
  SystemContextBuilder,
  type CapabilityDefinition,
} from './capability-projection.ts'

let passed = 0
function test(name: string, body: () => void): void {
  body()
  passed += 1
  console.log(`ok - ${name}`)
}

const read: CapabilityDefinition = {
  name: 'Read',
  description: 'Read a file',
  source: 'builtin',
  priority: 100,
}
const deploy: CapabilityDefinition = {
  name: 'Deploy',
  description: 'Deploy the service',
  source: 'plugin',
  priority: 50,
}

function defaultOptions(boundary: string) {
  return { boundary, mode: 'default', provider: 'first-party', model: 'large' }
}

test('catalog resolves same-name definitions by explicit priority', () => {
  const catalog = new CapabilityCatalog()
  const snapshot = catalog.publish([
    { ...read, description: 'plugin shadow', source: 'plugin', priority: 20 },
    read,
  ])
  assert.equal(snapshot.capabilities.length, 1)
  assert.equal(snapshot.capabilities[0]?.source, 'builtin')
  assert.equal(snapshot.capabilities[0]?.description, 'Read a file')
})

test('policy can hide an executable without removing its handler', () => {
  const catalog = new CapabilityCatalog()
  const projector = new CapabilityProjector()
  const registry = new ExecutableRegistry()
  const revision = catalog.publish([read, deploy])
  registry.register('Read', () => 'read')
  registry.register('Deploy', () => 'deployed')
  const snapshot = projector.project(revision, {
    ...defaultOptions('request-1'),
    policyHiddenNames: new Set(['Deploy']),
  })
  assert.deepEqual(snapshot.schemas.map(schema => schema.name), ['Read'])
  assert.deepEqual(registry.names(), ['Deploy', 'Read'])
  assert.equal(
    snapshot.decisions.find(decision => decision.name === 'Deploy')?.reason,
    'hidden-by-policy',
  )
})

test('publishing a new catalog revision does not mutate an old request view', () => {
  const catalog = new CapabilityCatalog()
  const projector = new CapabilityProjector()
  const revision1 = catalog.publish([read])
  const request1 = projector.project(revision1, defaultOptions('request-1'))
  const revision2 = catalog.publish([
    { name: 'Search', description: 'Search files', source: 'mcp', priority: 40 },
  ])
  assert.equal(request1.catalogRevision, 1)
  assert.deepEqual(request1.schemas.map(schema => schema.name), ['Read'])
  assert.equal(revision2.revision, 2)
  assert.deepEqual(
    revision2.capabilities.map(capability => capability.name),
    ['Read', 'Search'],
  )
})

test('an explicit refresh boundary creates a new capability snapshot', () => {
  const catalog = new CapabilityCatalog()
  const projector = new CapabilityProjector()
  const first = projector.project(
    catalog.publish([read]),
    defaultOptions('model-iteration-1'),
  )
  const second = projector.project(
    catalog.publish([
      { name: 'Search', description: 'Search files', source: 'mcp', priority: 40 },
    ]),
    defaultOptions('model-iteration-2'),
  )
  assert.deepEqual(first.schemas.map(schema => schema.name), ['Read'])
  assert.deepEqual(second.schemas.map(schema => schema.name), ['Read', 'Search'])
})

test('a deferred executable enters schemas only after discovery', () => {
  const catalog = new CapabilityCatalog()
  const projector = new CapabilityProjector()
  const registry = new ExecutableRegistry()
  const revision = catalog.publish([
    read,
    {
      name: 'Search',
      description: 'Search files',
      source: 'mcp',
      priority: 40,
      deferred: true,
    },
  ])
  registry.register('Read', () => 'read')
  registry.register('Search', () => 'searched')
  const before = projector.project(revision, defaultOptions('before-discovery'))
  const after = projector.project(revision, {
    ...defaultOptions('after-discovery'),
    discoveredDeferredNames: new Set(['Search']),
  })
  assert.deepEqual(before.schemas.map(schema => schema.name), ['Read'])
  assert.deepEqual(after.schemas.map(schema => schema.name), ['Read', 'Search'])
  assert.deepEqual(registry.names(), ['Read', 'Search'])
})

test('dispatch fails closed when a visible tool has no handler', () => {
  const catalog = new CapabilityCatalog()
  const snapshot = new CapabilityProjector().project(
    catalog.publish([
      { name: 'Ghost', description: 'Injected schema', source: 'dynamic', priority: 1 },
    ]),
    defaultOptions('request-with-divergence'),
  )
  assert.throws(
    () => new ExecutableRegistry().dispatch(snapshot, 'Ghost', {}),
    /visible tool has no executable handler/,
  )
})

test('mode, provider, and model constraints leave observable reasons', () => {
  const catalog = new CapabilityCatalog()
  const snapshot = new CapabilityProjector().project(
    catalog.publish([
      { ...read, name: 'ModeOnly', modes: ['plan'] },
      { ...read, name: 'ProviderOnly', providers: ['bedrock'] },
      { ...read, name: 'ModelOnly', models: ['small'] },
    ]),
    defaultOptions('filtered-request'),
  )
  assert.deepEqual(
    snapshot.decisions.map(decision => decision.reason),
    ['mode-mismatch', 'model-mismatch', 'provider-mismatch'],
  )
})

test('custom prompt replaces default while append remains a separate layer', () => {
  const builder = new SystemContextBuilder()
  const result = builder.build({
    defaultPrompt: ['default identity', 'default rules'],
    customPrompt: 'custom identity',
    appendPrompt: 'enterprise policy',
    userContext: { claudeMd: 'project guidance' },
    systemContext: { cwd: 'D:/work' },
  })
  assert.equal(result.base, 'custom')
  assert.deepEqual(result.systemPrompt, ['custom identity', 'enterprise policy'])
  assert.equal(result.metaUserContext.claudeMd, 'project guidance')
  assert.equal(result.systemContext.cwd, 'D:/work')
})

console.log(`TypeScript capability projection tests: ${passed} passed`)
