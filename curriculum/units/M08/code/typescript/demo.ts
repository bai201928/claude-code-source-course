import {
  CapabilityCatalog,
  CapabilityProjector,
  ExecutableRegistry,
} from './capability-projection.ts'

const catalog = new CapabilityCatalog()
const projector = new CapabilityProjector()
const registry = new ExecutableRegistry()
registry.register('Read', input => `read:${String(input)}`)
registry.register('Search', input => `search:${String(input)}`)

const revision1 = catalog.publish([
  { name: 'Read', description: 'Read a file', source: 'builtin', priority: 100 },
  { name: 'Deploy', description: 'Deploy', source: 'plugin', priority: 50 },
])
const first = projector.project(revision1, {
  boundary: 'model-iteration-1',
  mode: 'default',
  provider: 'first-party',
  model: 'large',
  policyHiddenNames: new Set(['Deploy']),
})

const revision2 = catalog.publish([
  {
    name: 'Search',
    description: 'Search files',
    source: 'mcp',
    priority: 40,
    deferred: true,
  },
])
const second = projector.project(revision2, {
  boundary: 'model-iteration-2',
  mode: 'default',
  provider: 'first-party',
  model: 'large',
  policyHiddenNames: new Set(['Deploy']),
  discoveredDeferredNames: new Set(['Search']),
})

console.log(JSON.stringify({
  oldSnapshot: { revision: first.catalogRevision, visible: first.schemas.map(s => s.name) },
  refreshedSnapshot: { revision: second.catalogRevision, visible: second.schemas.map(s => s.name) },
  registry: registry.names(),
  searchResult: registry.dispatch(second, 'Search', 'query loop'),
  decisions: second.decisions,
}, null, 2))

