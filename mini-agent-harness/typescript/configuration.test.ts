import assert from 'node:assert/strict'
import {
  assertEditableSource,
  deriveCanonicalOrder,
  deriveSnapshotCompatibleOrder,
  projectEnvironment,
  resolveConfiguration,
  type JsonObject,
} from './configuration.ts'

let passed = 0
function test(name: string, body: () => void): void {
  body()
  passed += 1
  console.log(`ok - ${name}`)
}

test('default merge preserves nested values and tracks provenance', () => {
  const snapshot = resolveConfiguration({
    revision: 1,
    sources: {
      userSettings: {
        settings: {
          permissions: { defaultMode: 'default', allow: ['Read', 'Bash(git status)'] },
        },
      },
      projectSettings: {
        settings: { permissions: { defaultMode: 'plan', allow: ['Read', 'Glob'] } },
      },
      flagSettings: {
        settings: { permissions: { defaultMode: 'acceptEdits' } },
      },
    },
    policyProviders: [
      { name: 'managedFile', settings: { permissions: { defaultMode: 'dontAsk' } } },
    ],
  })

  assert.deepEqual(snapshot.effective.permissions, {
    defaultMode: 'dontAsk',
    allow: ['Read', 'Bash(git status)', 'Glob'],
  })
  assert.equal(snapshot.provenance.leaves['permissions.defaultMode'], 'policySettings')
  assert.equal(snapshot.provenance.arrayItems['permissions.allow[0]'], 'userSettings')
  assert.equal(snapshot.provenance.arrayItems['permissions.allow[2]'], 'projectSettings')
})

test('snapshot-compatible selection exposes the conditional order difference', () => {
  assert.deepEqual(deriveCanonicalOrder([]), ['flagSettings', 'policySettings'])
  assert.deepEqual(deriveSnapshotCompatibleOrder([]), ['policySettings', 'flagSettings'])
  assert.deepEqual(deriveSnapshotCompatibleOrder(['localSettings', 'userSettings']), [
    'localSettings',
    'userSettings',
    'policySettings',
    'flagSettings',
  ])

  const common = {
    revision: 1,
    selectedOrdinarySources: [] as const,
    sources: { flagSettings: { settings: { model: 'flag-model' } } },
    policyProviders: [{ name: 'mdm' as const, settings: { model: 'policy-model' } }],
  }
  assert.equal(resolveConfiguration(common).effective.model, 'policy-model')
  assert.equal(
    resolveConfiguration({ ...common, orderMode: 'snapshot-compatible' }).effective.model,
    'flag-model',
  )
})

test('first valid non-empty policy provider wins as one provider', () => {
  const snapshot = resolveConfiguration({
    revision: 1,
    policyProviders: [
      { name: 'remote', settings: { model: 'bad' }, valid: false, error: 'remote invalid' },
      { name: 'mdm', settings: {} },
      { name: 'managedFile', settings: { model: 'managed', env: { A: 'one' } } },
      { name: 'hkcu', settings: { model: 'hkcu', env: { B: 'two' } } },
    ],
  })
  assert.equal(snapshot.policyProvider, 'managedFile')
  assert.equal(snapshot.effective.model, 'managed')
  assert.deepEqual(snapshot.effective.env, { A: 'one' })
  assert.deepEqual(snapshot.errors, ['remote invalid'])
})

test('invalid ordinary source is rejected as a whole', () => {
  const snapshot = resolveConfiguration({
    revision: 1,
    sources: {
      userSettings: { settings: { model: 'user' } },
      projectSettings: {
        settings: { model: 'project', permissions: { allow: ['Read'] } },
        valid: false,
        error: 'project schema rejected',
      },
    },
  })
  assert.equal(snapshot.effective.model, 'user')
  assert.equal(snapshot.effective.permissions, undefined)
  assert.deepEqual(snapshot.errors, ['project schema rejected'])
})

test('CLI flag file and SDK inline settings share one source with inline override', () => {
  const snapshot = resolveConfiguration({
    revision: 1,
    sources: {
      flagSettings: { settings: { model: 'file', permissions: { allow: ['Read'] } } },
    },
    flagInline: {
      settings: { model: 'inline', permissions: { allow: ['Glob'] } },
    },
  })
  assert.equal(snapshot.effective.model, 'inline')
  assert.deepEqual(snapshot.effective.permissions, { allow: ['Read', 'Glob'] })
  assert.equal(snapshot.provenance.leaves.model, 'flagSettings')
})

test('pre-trust env blocks endpoint redirect but permits safe provider switch', () => {
  const snapshot = resolveConfiguration({
    revision: 1,
    sources: {
      userSettings: {
        settings: { env: { ANTHROPIC_BASE_URL: 'https://user.example', USER_ONLY: 'yes' } },
      },
      projectSettings: {
        settings: {
          env: {
            ANTHROPIC_BASE_URL: 'https://project.example',
            CLAUDE_CODE_USE_BEDROCK: '1',
            PATH: 'project-bin',
          },
        },
      },
    },
  })
  assert.deepEqual(projectEnvironment(snapshot, 'pre-trust'), {
    ANTHROPIC_BASE_URL: 'https://user.example',
    USER_ONLY: 'yes',
    CLAUDE_CODE_USE_BEDROCK: '1',
  })
  assert.deepEqual(projectEnvironment(snapshot, 'trusted'), {
    ANTHROPIC_BASE_URL: 'https://project.example',
    USER_ONLY: 'yes',
    CLAUDE_CODE_USE_BEDROCK: '1',
    PATH: 'project-bin',
  })
})

test('flag and policy sources are read-only inside the harness', () => {
  assert.doesNotThrow(() => assertEditableSource('localSettings'))
  assert.throws(() => assertEditableSource('flagSettings'), /read-only/)
  assert.throws(() => assertEditableSource('policySettings'), /read-only/)
})

test('publishing a new snapshot does not mutate an older revision', () => {
  const source: JsonObject = { model: 'v1', nested: { value: 1 } }
  const first = resolveConfiguration({
    revision: 1,
    sources: { userSettings: { settings: source } },
  })
  source.model = 'v2'
  const second = resolveConfiguration({
    revision: 2,
    sources: { userSettings: { settings: source } },
  })
  assert.equal(first.effective.model, 'v1')
  assert.equal(second.effective.model, 'v2')
  assert.equal(Object.isFrozen(first.effective), true)
  assert.throws(() => {
    ;(first.effective as JsonObject).model = 'mutated'
  }, /read only|object is not extensible|Cannot assign/i)
})

test('explicit order must retain mandatory flag and policy layers', () => {
  assert.throws(
    () => resolveConfiguration({ revision: 1, sourceOrder: ['userSettings'] }),
    /must be present/,
  )
})

console.log(`TypeScript M06 tests: ${passed} passed`)

