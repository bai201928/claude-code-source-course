import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveHarnessSettings, resolveProviderCredential } from './config.ts'

test('resolves public settings without copying the provider credential', () => {
  const env = {
    MINI_AGENT_API_KEY: 'dummy-test-key',
    MINI_AGENT_MODEL: 'model-from-env',
    MINI_AGENT_GRANTED_EXECUTABLES: 'node, rg,node',
  }

  const settings = resolveHarnessSettings(env, { maxTurns: 3 })
  const credential = resolveProviderCredential(env)

  assert.equal(settings.model, 'model-from-env')
  assert.equal(settings.maxTurns, 3)
  assert.deepEqual(settings.grantedExecutables, ['node', 'rg'])
  assert.equal(Object.hasOwn(settings, 'apiKey'), false)
  assert.equal(credential.apiKey, 'dummy-test-key')
  assert.throws(() => resolveProviderCredential({}), /MINI_AGENT_API_KEY/)
})
