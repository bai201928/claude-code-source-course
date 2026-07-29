export type ToolRisk = 'read' | 'execute'

export type PermissionRequest = Readonly<{
  toolName: string
  risk: ToolRisk
  command?: string
}>

export type PermissionDecision = Readonly<{
  allowed: boolean
  reason: string
}>

export interface PermissionGate {
  decide(
    request: PermissionRequest,
    signal: AbortSignal,
  ): PermissionDecision | Promise<PermissionDecision>
}

export class PolicyPermissionGate implements PermissionGate {
  readonly #grantedExecutables: ReadonlySet<string>

  constructor(grantedExecutables: Iterable<string> = []) {
    this.#grantedExecutables = new Set(
      [...grantedExecutables].map(value => value.trim()).filter(Boolean),
    )
  }

  decide(request: PermissionRequest, _signal: AbortSignal): PermissionDecision {
    if (request.risk === 'read') {
      return Object.freeze({ allowed: true, reason: 'workspace-read-policy' })
    }
    if (request.command && this.#grantedExecutables.has(request.command)) {
      return Object.freeze({ allowed: true, reason: 'explicit-unrestricted-executable-grant' })
    }
    return Object.freeze({
      allowed: false,
      reason: request.command
        ? `executable has no unrestricted grant: ${request.command}`
        : 'execution tool requires an explicit executable identity',
    })
  }
}

export class PermissionDeniedError extends Error {
  readonly decision: PermissionDecision

  constructor(decision: PermissionDecision) {
    super(decision.reason)
    this.name = 'PermissionDeniedError'
    this.decision = decision
  }
}
