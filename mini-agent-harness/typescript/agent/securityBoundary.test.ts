import assert from 'node:assert/strict'
import path from 'node:path'
import {
  PolicyEngine,
  SecurityExecutor,
  StalePolicyRevisionError,
  type ExecutionRequest,
  type SandboxPort,
  type SecurityPolicy,
  type SecretResolver,
  type TrustedExecutionEnvelope,
  type WorkerResult,
} from './securityBoundary.ts'

const workspace = path.resolve('security-fixture')

const basePolicy = (): SecurityPolicy => ({
  revision: 1,
  requireSandbox: true,
  allowedWorkerIds: ['worker-1'],
  filesystem: { readRoots: [workspace], writeRoots: [workspace] },
  network: { allowedHosts: ['api.example.com'] },
  processRules: [{ executable: 'git', allowedArgvPrefixes: [['status'], ['diff']] }],
  trustedExtensions: [{ extensionId: 'reviewer', source: 'corp-market', digest: 'sha256:known' }],
})

const request = (overrides: Partial<ExecutionRequest> = {}): ExecutionRequest => ({
  callId: 'call-1',
  workerId: 'worker-1',
  policyRevision: 1,
  permissionGranted: true,
  effect: { kind: 'filesystem', operation: 'read', path: path.join(workspace, 'input.txt') },
  ...overrides,
})

class FakeSandbox implements SandboxPort {
  readonly workerId: string
  available = true
  calls: TrustedExecutionEnvelope[] = []

  constructor(workerId = 'worker-1') {
    this.workerId = workerId
  }

  isAvailable(): boolean {
    return this.available
  }

  async execute(envelope: TrustedExecutionEnvelope, signal: AbortSignal): Promise<WorkerResult> {
    signal.throwIfAborted()
    this.calls.push(envelope)
    return { status: 'completed', outputRef: 'artifact://result' }
  }
}

const resolver = (values: Record<string, string> = {}): SecretResolver => ({
  resolve: ref => values[ref],
})

const tests: Array<readonly [string, () => void | Promise<void>]> = []
const test = (name: string, body: () => void | Promise<void>) => tests.push([name, body])

test('policy replacement uses optimistic revision', () => {
  const policies = new PolicyEngine(basePolicy())
  const next = policies.replace(1, { ...basePolicy(), requireSandbox: false })
  assert.equal(next.revision, 2)
  assert.throws(
    () => policies.replace(1, { ...basePolicy(), requireSandbox: true }),
    StalePolicyRevisionError,
  )
})

test('stale request policy is rejected before worker effect', async () => {
  const sandbox = new FakeSandbox()
  const policies = new PolicyEngine(basePolicy())
  policies.replace(1, { ...basePolicy(), requireSandbox: true })
  const result = await new SecurityExecutor(policies, sandbox, resolver()).execute(
    request(),
    new AbortController().signal,
  )
  assert.equal(result.report.reason, 'stale_policy')
  assert.equal(sandbox.calls.length, 0)
})

test('Permission allow cannot bypass Sandbox filesystem denial', async () => {
  const sandbox = new FakeSandbox()
  const result = await new SecurityExecutor(
    new PolicyEngine(basePolicy()), sandbox, resolver(),
  ).execute(request({ effect: { kind: 'filesystem', operation: 'write', path: path.resolve('outside.txt') } }), new AbortController().signal)
  assert.equal(result.report.reason, 'capability_denied')
  assert.equal(sandbox.calls.length, 0)
})

test('required Sandbox unavailable fails closed', async () => {
  const sandbox = new FakeSandbox()
  sandbox.available = false
  const result = await new SecurityExecutor(
    new PolicyEngine(basePolicy()), sandbox, resolver(),
  ).execute(request(), new AbortController().signal)
  assert.equal(result.report.reason, 'sandbox_unavailable')
  assert.equal(sandbox.calls.length, 0)
})

test('network and process argv constraints are independent', async () => {
  const sandbox = new FakeSandbox()
  const executor = new SecurityExecutor(new PolicyEngine(basePolicy()), sandbox, resolver())
  const network = await executor.execute(request({ effect: { kind: 'network', operation: 'connect', host: 'evil.example' } }), new AbortController().signal)
  const process = await executor.execute(request({ effect: { kind: 'process', operation: 'spawn', executable: 'git', argv: ['-c', 'core.sshCommand=evil', 'status'] } }), new AbortController().signal)
  assert.equal(network.report.reason, 'capability_denied')
  assert.equal(process.report.reason, 'capability_denied')
  assert.equal(sandbox.calls.length, 0)
})

test('secret value exists only inside trusted worker envelope', async () => {
  const sandbox = new FakeSandbox()
  const req = request({ secretRefs: ['provider-key'] })
  const result = await new SecurityExecutor(
    new PolicyEngine(basePolicy()), sandbox, resolver({ 'provider-key': 'highly-sensitive-value' }),
  ).execute(req, new AbortController().signal)
  assert.equal(result.ok, true)
  assert.equal(sandbox.calls[0]!.resolvedSecrets.get('provider-key'), 'highly-sensitive-value')
  assert(!JSON.stringify(req).includes('highly-sensitive-value'))
  assert(!JSON.stringify(result.report).includes('highly-sensitive-value'))
})

test('missing secret fails closed before worker', async () => {
  const sandbox = new FakeSandbox()
  const result = await new SecurityExecutor(
    new PolicyEngine(basePolicy()), sandbox, resolver(),
  ).execute(request({ secretRefs: ['missing'] }), new AbortController().signal)
  assert.equal(result.report.reason, 'secret_missing')
  assert.equal(sandbox.calls.length, 0)
})

test('policy refresh during secret resolution invalidates the request', async () => {
  const sandbox = new FakeSandbox()
  const policies = new PolicyEngine(basePolicy())
  const result = await new SecurityExecutor(policies, sandbox, {
    resolve: () => {
      policies.replace(1, { ...basePolicy(), requireSandbox: true })
      return Promise.resolve('resolved-at-boundary')
    },
  }).execute(request({ secretRefs: ['provider-key'] }), new AbortController().signal)
  assert.equal(result.report.reason, 'stale_policy')
  assert.equal(sandbox.calls.length, 0)
})

test('unknown extension is rejected and exact trusted provenance is accepted', async () => {
  const sandbox = new FakeSandbox()
  const executor = new SecurityExecutor(new PolicyEngine(basePolicy()), sandbox, resolver())
  const denied = await executor.execute(request({ extension: { extensionId: 'reviewer', source: 'public-market', digest: 'sha256:known' } }), new AbortController().signal)
  const allowed = await executor.execute(request({ extension: { extensionId: 'reviewer', source: 'corp-market', digest: 'sha256:known' } }), new AbortController().signal)
  assert.equal(denied.report.reason, 'extension_untrusted')
  assert.equal(allowed.ok, true)
  assert.equal(sandbox.calls.length, 1)
})

test('cancellation before effect never reaches worker', async () => {
  const sandbox = new FakeSandbox()
  const controller = new AbortController()
  controller.abort('stop')
  const result = await new SecurityExecutor(
    new PolicyEngine(basePolicy()), sandbox, resolver(),
  ).execute(request(), controller.signal)
  assert.equal(result.report.reason, 'cancelled')
  assert.equal(sandbox.calls.length, 0)
})

let passed = 0
for (const [name, body] of tests) {
  await body()
  passed++
  process.stdout.write(`ok ${passed} - ${name}\n`)
}
process.stdout.write(`1..${passed}\n`)
