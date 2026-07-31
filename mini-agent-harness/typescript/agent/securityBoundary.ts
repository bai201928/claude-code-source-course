import path from 'node:path'

export type FilesystemPolicy = Readonly<{
  readRoots: readonly string[]
  writeRoots: readonly string[]
}>

export type NetworkPolicy = Readonly<{
  allowedHosts: readonly string[]
}>

export type ProcessRule = Readonly<{
  executable: string
  allowedArgvPrefixes: readonly (readonly string[])[]
}>

export type ExtensionTrustRule = Readonly<{
  extensionId: string
  source: string
  digest?: string
}>

export type SecurityPolicy = Readonly<{
  revision: number
  requireSandbox: boolean
  allowedWorkerIds: readonly string[]
  filesystem: FilesystemPolicy
  network: NetworkPolicy
  processRules: readonly ProcessRule[]
  trustedExtensions: readonly ExtensionTrustRule[]
}>

export type SecurityPolicyDraft = Omit<SecurityPolicy, 'revision'>

export type EffectRequest =
  | Readonly<{ kind: 'filesystem'; operation: 'read' | 'write'; path: string }>
  | Readonly<{ kind: 'network'; operation: 'connect'; host: string }>
  | Readonly<{
      kind: 'process'
      operation: 'spawn'
      executable: string
      argv: readonly string[]
    }>

export type ExtensionProvenance = Readonly<{
  extensionId: string
  source: string
  digest?: string
}>

/** This is the model/control-plane envelope. It never carries secret values. */
export type ExecutionRequest = Readonly<{
  callId: string
  workerId: string
  policyRevision: number
  permissionGranted: boolean
  effect: EffectRequest
  secretRefs?: readonly string[]
  extension?: ExtensionProvenance
}>

/** This envelope exists only inside the trusted execution boundary. */
export type TrustedExecutionEnvelope = Readonly<{
  callId: string
  workerId: string
  policyRevision: number
  effect: EffectRequest
  resolvedSecrets: ReadonlyMap<string, string>
  extension?: ExtensionProvenance
}>

export type WorkerResult = Readonly<{
  status: 'completed'
  outputRef?: string
}>

export type SecurityReason =
  | 'allowed'
  | 'permission_denied'
  | 'stale_policy'
  | 'worker_denied'
  | 'worker_mismatch'
  | 'sandbox_unavailable'
  | 'capability_denied'
  | 'extension_untrusted'
  | 'secret_missing'
  | 'cancelled'

export type SecurityReport = Readonly<{
  callId: string
  decision: 'allow' | 'deny'
  reason: SecurityReason
  policyRevision: number
  workerId: string
  capability: EffectRequest['kind']
  secretRefIds: readonly string[]
  extensionId?: string
  sandboxed: boolean
}>

export type SecurityExecutionResult =
  | Readonly<{ ok: true; report: SecurityReport; workerResult: WorkerResult }>
  | Readonly<{ ok: false; report: SecurityReport }>

export interface SecretResolver {
  resolve(ref: string): string | undefined | Promise<string | undefined>
}
/**
 * A port, not an OS sandbox implementation. Production adapters must enforce
 * the envelope at the process/container boundary.
 */
export interface SandboxPort {
  readonly workerId: string
  isAvailable(): boolean
  execute(envelope: TrustedExecutionEnvelope, signal: AbortSignal): Promise<WorkerResult>
}

export class StalePolicyRevisionError extends Error {}

export class PolicyEngine {
  #policy: SecurityPolicy

  constructor(initial: SecurityPolicy) {
    this.#policy = freezePolicy(initial)
  }

  snapshot(): SecurityPolicy {
    return this.#policy
  }

  replace(expectedRevision: number, draft: SecurityPolicyDraft): SecurityPolicy {
    if (expectedRevision !== this.#policy.revision) {
      throw new StalePolicyRevisionError(
        `stale policy revision ${expectedRevision}; current=${this.#policy.revision}`,
      )
    }
    this.#policy = freezePolicy({ ...structuredClone(draft), revision: expectedRevision + 1 })
    return this.#policy
  }
}

export class SecurityExecutor {
  readonly #policies: PolicyEngine
  readonly #sandbox: SandboxPort
  readonly #secrets: SecretResolver

  constructor(policies: PolicyEngine, sandbox: SandboxPort, secrets: SecretResolver) {
    this.#policies = policies
    this.#sandbox = sandbox
    this.#secrets = secrets
  }

  async execute(request: ExecutionRequest, signal: AbortSignal): Promise<SecurityExecutionResult> {
    const secretRefs = Object.freeze([...(request.secretRefs ?? [])])
    const firstPolicy = this.#policies.snapshot()
    const deny = (reason: Exclude<SecurityReason, 'allowed'>): SecurityExecutionResult =>
      Object.freeze({ ok: false, report: reportFor(request, firstPolicy, secretRefs, reason) })

    if (signal.aborted) return deny('cancelled')
    if (!request.permissionGranted) return deny('permission_denied')
    if (request.policyRevision !== firstPolicy.revision) return deny('stale_policy')
    if (!firstPolicy.allowedWorkerIds.includes(request.workerId)) return deny('worker_denied')
    if (this.#sandbox.workerId !== request.workerId) return deny('worker_mismatch')
    if (firstPolicy.requireSandbox && !this.#sandbox.isAvailable()) return deny('sandbox_unavailable')
    if (!allowsEffect(firstPolicy, request.effect)) return deny('capability_denied')
    if (request.extension && !allowsExtension(firstPolicy, request.extension)) {
      return deny('extension_untrusted')
    }

    const resolvedSecrets = new Map<string, string>()
    for (const ref of secretRefs) {
      if (signal.aborted) return deny('cancelled')
      const value = await this.#secrets.resolve(ref)
      if (signal.aborted) return deny('cancelled')
      if (value === undefined) return deny('secret_missing')
      resolvedSecrets.set(ref, value)
    }

    // Policy may refresh while a secret store or broker is being consulted.
    if (this.#policies.snapshot().revision !== firstPolicy.revision) return deny('stale_policy')
    if (signal.aborted) return deny('cancelled')
    if (firstPolicy.requireSandbox && !this.#sandbox.isAvailable()) return deny('sandbox_unavailable')

    const envelope: TrustedExecutionEnvelope = Object.freeze({
      callId: request.callId,
      workerId: request.workerId,
      policyRevision: firstPolicy.revision,
      effect: freezeEffect(request.effect),
      resolvedSecrets,
      ...(request.extension ? { extension: Object.freeze({ ...request.extension }) } : {}),
    })
    const workerResult = await this.#sandbox.execute(envelope, signal)
    return Object.freeze({
      ok: true,
      workerResult,
      report: reportFor(request, firstPolicy, secretRefs, 'allowed'),
    })
  }
}

function allowsEffect(policy: SecurityPolicy, effect: EffectRequest): boolean {
  switch (effect.kind) {
    case 'filesystem': {
      const roots = effect.operation === 'read'
        ? policy.filesystem.readRoots
        : policy.filesystem.writeRoots
      return roots.some(root => isWithin(root, effect.path))
    }
    case 'network':
      return policy.network.allowedHosts.some(pattern => hostMatches(pattern, effect.host))
    case 'process':
      return policy.processRules.some(rule =>
        rule.executable === effect.executable
        && rule.allowedArgvPrefixes.some(prefix => startsWith(effect.argv, prefix)),
      )
  }
}

function allowsExtension(policy: SecurityPolicy, extension: ExtensionProvenance): boolean {
  return policy.trustedExtensions.some(rule =>
    rule.extensionId === extension.extensionId
    && rule.source === extension.source
    && (rule.digest === undefined || rule.digest === extension.digest),
  )
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function hostMatches(pattern: string, host: string): boolean {
  const normalizedPattern = pattern.toLowerCase()
  const normalizedHost = host.toLowerCase()
  return normalizedPattern.startsWith('*.')
    ? normalizedHost.endsWith(normalizedPattern.slice(1))
    : normalizedHost === normalizedPattern
}

function startsWith(actual: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= actual.length && prefix.every((value, index) => actual[index] === value)
}

function reportFor(
  request: ExecutionRequest,
  policy: SecurityPolicy,
  secretRefs: readonly string[],
  reason: SecurityReason,
): SecurityReport {
  return Object.freeze({
    callId: request.callId,
    decision: reason === 'allowed' ? 'allow' : 'deny',
    reason,
    policyRevision: policy.revision,
    workerId: request.workerId,
    capability: request.effect.kind,
    secretRefIds: secretRefs,
    ...(request.extension ? { extensionId: request.extension.extensionId } : {}),
    sandboxed: policy.requireSandbox && reason === 'allowed',
  })
}

function freezePolicy(policy: SecurityPolicy): SecurityPolicy {
  if (!Number.isInteger(policy.revision) || policy.revision < 1) {
    throw new Error('policy revision must be a positive integer')
  }
  if (policy.allowedWorkerIds.length === 0) throw new Error('policy requires at least one worker')
  return deepFreeze(structuredClone(policy))
}

function freezeEffect(effect: EffectRequest): EffectRequest {
  return deepFreeze(structuredClone(effect))
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
