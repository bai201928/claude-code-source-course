import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityCatalog } from '../capabilityProjection.ts'
import {
  ExtensionRegistry,
  SignatureTrustPolicy,
  StaleExtensionRevisionError,
  type ExtensionBundle,
} from './extensionRegistry.ts'

test('full source identity distinguishes marketplace materializations', () => {
  const registry = new ExtensionRegistry()
  const result = registry.publish(0, [
    bundle('market-a', 'alpha'),
    bundle('market-b', 'beta', 'Write'),
  ])
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(new Set(result.snapshot.entries.map(item => item.bundleKey)).size, 2)
})

test('collision is explicit and cannot partially publish', () => {
  const registry = new ExtensionRegistry()
  const result = registry.publish(0, [bundle('market-a', 'same'), bundle('market-b', 'same')])
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.deepEqual(result.conflicts.map(item => item.qualifiedName), ['demo:Read'])
  assert.equal(registry.snapshot().revision, 0)
  assert.deepEqual(registry.snapshot().entries, [])
})

test('bundle replacement is revisioned and old snapshots stay immutable', () => {
  const registry = new ExtensionRegistry()
  const first = registry.publish(0, [bundle('market-a', 'one')])
  assert.equal(first.ok, true)
  if (!first.ok) return
  const old = first.snapshot
  const second = registry.publish(1, [bundle('market-a', 'two', 'Write')])
  assert.equal(second.ok, true)
  assert.deepEqual(old.entries.map(item => item.qualifiedName), ['demo:Read'])
  assert.equal(Object.isFrozen(old.entries), true)
  assert.throws(() => registry.publish(1, []), StaleExtensionRevisionError)
})

test('unload removes components from new snapshots', () => {
  const registry = new ExtensionRegistry()
  const loaded = registry.publish(0, [bundle('market-a', 'one')])
  assert.equal(loaded.ok, true)
  const unloaded = registry.publish(1, [])
  assert.equal(unloaded.ok, true)
  if (!unloaded.ok) return
  assert.deepEqual(unloaded.snapshot.entries, [])
})

test('old snapshot cannot start a new execution after unload', () => {
  const registry = new ExtensionRegistry()
  const loaded = registry.publish(0, [bundle('market-a', 'one')])
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  registry.publish(1, [])
  assert.throws(() => registry.acquire(loaded.snapshot, 'demo:Read'), /no longer active/)
})

test('an acquired lease survives unload until cooperative release', () => {
  const registry = new ExtensionRegistry()
  const loaded = registry.publish(0, [bundle('market-a', 'one')])
  assert.equal(loaded.ok, true)
  if (!loaded.ok) return
  const lease = registry.acquire(loaded.snapshot, 'demo:Read')
  registry.publish(1, [])
  assert.equal(lease.isValid(), true)
  lease.release()
  assert.equal(lease.isValid(), false)
})

test('trust policy rejects unsigned or untrusted bundles before publication', () => {
  const registry = new ExtensionRegistry(new SignatureTrustPolicy())
  assert.throws(() => registry.publish(0, [{
    ...bundle('market-a', 'one'),
    trust: 'signed',
    signature: undefined,
  }]), /signature/)
  assert.throws(() => registry.publish(0, [{ ...bundle('market-a', 'one'), trust: 'untrusted' }]), /untrusted/)
  assert.equal(registry.snapshot().revision, 0)
})

test('approved snapshot adapts to catalog while trace remains metadata-only', () => {
  const registry = new ExtensionRegistry()
  const published = registry.publish(0, [bundle('market-a', 'one')])
  assert.equal(published.ok, true)
  if (!published.ok) return
  const definitions = registry.toCapabilityDefinitions(published.snapshot)
  const catalog = new CapabilityCatalog().publish(definitions)
  assert.deepEqual(catalog.capabilities.map(item => item.name), ['demo:Read'])
  assert.equal(JSON.stringify(registry.traces()).includes('secret-signature'), false)
})

function bundle(marketplace: string, locator: string, name = 'Read'): ExtensionBundle {
  return {
    namespace: 'demo',
    source: { marketplace, locator, plugin: 'sample', version: '1.0.0' },
    trust: 'local-trusted',
    signature: 'secret-signature',
    components: [{ kind: 'skill', name, description: `${name} files` }],
  }
}
