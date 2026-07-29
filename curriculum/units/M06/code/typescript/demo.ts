import {
  deriveSnapshotCompatibleOrder,
  projectEnvironment,
  resolveConfiguration,
} from './configuration.ts'

const snapshot = resolveConfiguration({
  revision: 7,
  sources: {
    userSettings: {
      settings: {
        permissions: { defaultMode: 'default', allow: ['Read'] },
        env: { ANTHROPIC_BASE_URL: 'https://user.example' },
      },
    },
    projectSettings: {
      settings: {
        permissions: { defaultMode: 'plan', allow: ['Read', 'Glob'] },
        env: {
          ANTHROPIC_BASE_URL: 'https://project.example',
          CLAUDE_CODE_USE_BEDROCK: '1',
        },
      },
    },
    flagSettings: {
      settings: { permissions: { defaultMode: 'acceptEdits' } },
    },
  },
  policyProviders: [
    { name: 'remote', settings: {}, valid: false, error: 'remote schema rejected' },
    {
      name: 'managedFile',
      settings: { permissions: { defaultMode: 'dontAsk' } },
    },
  ],
})

console.log('canonical order:', snapshot.sourceOrder.join(' -> '))
console.log(
  'snapshot order with --setting-sources "":',
  deriveSnapshotCompatibleOrder([]).join(' -> '),
)
console.log('policy provider:', snapshot.policyProvider)
console.log('effective:', JSON.stringify(snapshot.effective, null, 2))
console.log('defaultMode source:', snapshot.provenance.leaves['permissions.defaultMode'])
console.log('pre-trust env:', projectEnvironment(snapshot, 'pre-trust'))
console.log('trusted env:', projectEnvironment(snapshot, 'trusted'))
console.log('errors:', snapshot.errors)

