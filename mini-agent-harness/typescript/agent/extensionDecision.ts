import type {
  PermissionDecision,
  PermissionGate,
  PermissionRequest,
} from './permissions.ts'

export type DecisionBehavior = 'allow' | 'ask' | 'deny'

export type DecisionEvidence = Readonly<{
  stage: 'pre-hook' | 'policy' | 'resolver' | 'post-hook' | 'abort'
  sourceId: string
  behavior: DecisionBehavior | 'continue' | 'stop'
  revision: number
}>

export type DecisionContext = Readonly<{
  callId: string
  toolName: string
  revision: number
  input: Readonly<Record<string, unknown>>
}>

export type PreHookResult = Readonly<{
  behavior?: DecisionBehavior
  updatedInput?: Readonly<Record<string, unknown>>
}>

export type PreDecisionHook = Readonly<{
  id: string
  run(context: DecisionContext, signal: AbortSignal): PreHookResult | Promise<PreHookResult>
}>

export type PostDecisionHook = Readonly<{
  id: string
  run(
    context: DecisionContext & Readonly<{ succeeded: boolean }>,
    signal: AbortSignal,
  ): Readonly<{ blockContinuation?: boolean }> | Promise<Readonly<{ blockContinuation?: boolean }>>
}>

export type AskResolution = PermissionDecision & Readonly<{
  updatedInput?: Readonly<Record<string, unknown>>
}>

export type AskResolver = (
  context: DecisionContext,
  evidence: readonly DecisionEvidence[],
  signal: AbortSignal,
) => AskResolution | Promise<AskResolution>

export type PreparedDecision = Readonly<{
  context: DecisionContext
  decision: PermissionDecision
  evidence: readonly DecisionEvidence[]
}>

export type PostDecision = Readonly<{
  continueConversation: boolean
  evidence: readonly DecisionEvidence[]
}>

export class ExtensionDecisionPipeline {
  readonly #preHooks: readonly PreDecisionHook[]
  readonly #postHooks: readonly PostDecisionHook[]
  readonly #askResolver?: AskResolver

  constructor(options: Readonly<{
    preHooks?: readonly PreDecisionHook[]
    postHooks?: readonly PostDecisionHook[]
    askResolver?: AskResolver
  }> = {}) {
    this.#preHooks = Object.freeze([...(options.preHooks ?? [])])
    this.#postHooks = Object.freeze([...(options.postHooks ?? [])])
    this.#askResolver = options.askResolver
    assertUniqueHookIds([...this.#preHooks, ...this.#postHooks])
  }

  async prepare(options: Readonly<{
    callId: string
    toolName: string
    input: Readonly<Record<string, unknown>>
    validateSchema(input: Readonly<Record<string, unknown>>): void
    validateSemantics?(input: Readonly<Record<string, unknown>>): void | Promise<void>
    permissionRequest(input: Readonly<Record<string, unknown>>): PermissionRequest
    gate: PermissionGate
    signal: AbortSignal
  }>): Promise<PreparedDecision> {
    throwIfAborted(options.signal)
    let context = freezeContext(options.callId, options.toolName, 0, options.input)
    const evidence: DecisionEvidence[] = []
    const proposals: DecisionBehavior[] = []
    options.validateSchema(context.input)
    if (options.validateSemantics) {
      await options.validateSemantics(context.input)
    }

    for (const hook of this.#preHooks) {
      throwIfAborted(options.signal)
      const result = Object.freeze(await hook.run(context, options.signal))
      if (result.updatedInput !== undefined) {
        context = freezeContext(
          context.callId,
          context.toolName,
          context.revision + 1,
          result.updatedInput,
        )
        options.validateSchema(context.input)
        if (options.validateSemantics) {
          await options.validateSemantics(context.input)
        }
      }
      if (result.behavior) {
        proposals.push(result.behavior)
        evidence.push(freezeEvidence('pre-hook', hook.id, result.behavior, context.revision))
      }
    }

    throwIfAborted(options.signal)
    const policy = Object.freeze(await abortable(
      options.gate.decide(options.permissionRequest(context.input), options.signal),
      options.signal,
    ))
    const policyBehavior: DecisionBehavior = policy.allowed ? 'allow' : 'deny'
    evidence.push(freezeEvidence('policy', 'permission-gate', policyBehavior, context.revision))

    if (!policy.allowed || proposals.includes('deny')) {
      const reason = !policy.allowed ? policy.reason : 'pre-hook-deny'
      return freezePrepared(context, { allowed: false, reason }, evidence)
    }

    if (proposals.includes('ask')) {
      if (!this.#askResolver) {
        evidence.push(freezeEvidence('resolver', 'missing-resolver', 'deny', context.revision))
        return freezePrepared(
          context,
          { allowed: false, reason: 'approval-required-without-resolver' },
          evidence,
        )
      }
      let resolved: AskResolution
      try {
        resolved = Object.freeze(await abortable(
          this.#askResolver(context, Object.freeze([...evidence]), options.signal),
          options.signal,
        ))
      } catch (error) {
        if (options.signal.aborted) throw error
        evidence.push(freezeEvidence('resolver', 'resolver-error', 'deny', context.revision))
        return freezePrepared(context, { allowed: false, reason: 'approval-resolver-failed' }, evidence)
      }
      evidence.push(freezeEvidence(
        'resolver',
        'ask-resolver',
        resolved.allowed ? 'allow' : 'deny',
        context.revision,
      ))
      if (!resolved.allowed) return freezePrepared(context, resolved, evidence)
      if (resolved.updatedInput !== undefined) {
        context = freezeContext(
          context.callId,
          context.toolName,
          context.revision + 1,
          resolved.updatedInput,
        )
        options.validateSchema(context.input)
        if (options.validateSemantics) {
          await options.validateSemantics(context.input)
        }
        throwIfAborted(options.signal)
        const rewrittenPolicy = Object.freeze(await abortable(
          options.gate.decide(options.permissionRequest(context.input), options.signal),
          options.signal,
        ))
        evidence.push(freezeEvidence(
          'policy',
          'permission-gate-after-resolver-rewrite',
          rewrittenPolicy.allowed ? 'allow' : 'deny',
          context.revision,
        ))
        if (!rewrittenPolicy.allowed) {
          return freezePrepared(context, rewrittenPolicy, evidence)
        }
      }
    }

    throwIfAborted(options.signal)
    return freezePrepared(context, policy, evidence)
  }

  async after(
    prepared: PreparedDecision,
    succeeded: boolean,
    signal: AbortSignal,
  ): Promise<PostDecision> {
    const evidence = [...prepared.evidence]
    let continueConversation = true
    for (const hook of this.#postHooks) {
      const result = Object.freeze(await hook.run(
        Object.freeze({ ...prepared.context, succeeded }),
        signal,
      ))
      if (result.blockContinuation) {
        continueConversation = false
        evidence.push(freezeEvidence(
          'post-hook',
          hook.id,
          'stop',
          prepared.context.revision,
        ))
      } else {
        evidence.push(freezeEvidence(
          'post-hook',
          hook.id,
          'continue',
          prepared.context.revision,
        ))
      }
    }
    return Object.freeze({
      continueConversation,
      evidence: Object.freeze(evidence),
    })
  }
}

function freezeContext(
  callId: string,
  toolName: string,
  revision: number,
  input: Readonly<Record<string, unknown>>,
): DecisionContext {
  return Object.freeze({
    callId,
    toolName,
    revision,
    input: deepFreeze(structuredClone(input)),
  })
}

function freezeEvidence(
  stage: DecisionEvidence['stage'],
  sourceId: string,
  behavior: DecisionEvidence['behavior'],
  revision: number,
): DecisionEvidence {
  return Object.freeze({ stage, sourceId, behavior, revision })
}

function freezePrepared(
  context: DecisionContext,
  decision: PermissionDecision,
  evidence: readonly DecisionEvidence[],
): PreparedDecision {
  return Object.freeze({
    context,
    decision: Object.freeze({ ...decision }),
    evidence: Object.freeze([...evidence]),
  })
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item)
  }
  return value
}

async function abortable<T>(value: T | Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('decision cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([Promise.resolve(value), cancelled])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('operation cancelled')
}

function assertUniqueHookIds(hooks: readonly Readonly<{ id: string }>[]): void {
  const seen = new Set<string>()
  for (const hook of hooks) {
    if (!hook.id.trim()) throw new Error('hook id must not be empty')
    if (seen.has(hook.id)) throw new Error(`duplicate hook id: ${hook.id}`)
    seen.add(hook.id)
  }
}
