import type { CapabilityDefinition } from '../capabilityProjection.ts'

export type ExtensionComponentKind = 'skill' | 'command' | 'tool' | 'agent'
export type ExtensionTrust = 'local-trusted' | 'signed' | 'untrusted'

export type ExtensionSourceIdentity = Readonly<{
  marketplace: string
  locator: string
  plugin: string
  version: string
}>

export type ExtensionComponent = Readonly<{
  kind: ExtensionComponentKind
  name: string
  description: string
  priority?: number
  deferred?: boolean
}>

export type ExtensionBundle = Readonly<{
  namespace: string
  source: ExtensionSourceIdentity
  trust: ExtensionTrust
  signature?: string
  components: readonly ExtensionComponent[]
}>

export type RegisteredExtension = Readonly<{
  qualifiedName: string
  bundleKey: string
  namespace: string
  source: ExtensionSourceIdentity
  component: ExtensionComponent
}>

export type ExtensionSnapshot = Readonly<{
  revision: number
  entries: readonly RegisteredExtension[]
}>

export type ExtensionConflict = Readonly<{
  qualifiedName: string
  bundleKeys: readonly string[]
}>

export type ExtensionPublication =
  | Readonly<{ ok: true; snapshot: ExtensionSnapshot }>
  | Readonly<{ ok: false; revision: number; conflicts: readonly ExtensionConflict[] }>

export type ExtensionTrace = Readonly<{
  action: 'publish' | 'reject-conflict' | 'acquire' | 'release'
  revision: number
  bundleCount: number
  conflictCount: number
}>

export interface ExtensionTrustPolicy {
  assertAllowed(bundle: ExtensionBundle): void
}

export class SignatureTrustPolicy implements ExtensionTrustPolicy {
  assertAllowed(bundle: ExtensionBundle): void {
    if (bundle.trust === 'untrusted') throw new Error('untrusted extension bundle')
    if (bundle.trust === 'signed' && !bundle.signature?.trim()) {
      throw new Error('signed extension bundle requires signature evidence')
    }
  }
}

export type ExtensionLease = Readonly<{
  bundleKey: string
  qualifiedName: string
  acquiredRevision: number
  isValid(): boolean
  release(): void
}>

export class StaleExtensionRevisionError extends Error {}

export class ExtensionRegistry {
  #revision = 0
  #entries: readonly RegisteredExtension[] = Object.freeze([])
  #activeBundleKeys = new Set<string>()
  #leaseSequence = 0
  readonly #leases = new Map<number, { released: boolean }>()
  readonly #trustPolicy: ExtensionTrustPolicy
  readonly #trace: ExtensionTrace[] = []

  constructor(trustPolicy: ExtensionTrustPolicy = new SignatureTrustPolicy()) {
    this.#trustPolicy = trustPolicy
  }

  snapshot(): ExtensionSnapshot {
    return deepFreeze({ revision: this.#revision, entries: this.#entries })
  }

  publish(expectedRevision: number, bundles: readonly ExtensionBundle[]): ExtensionPublication {
    if (expectedRevision !== this.#revision) {
      throw new StaleExtensionRevisionError(
        `stale extension revision ${expectedRevision}; current=${this.#revision}`,
      )
    }
    const frozenBundles = bundles.map(bundle => validateAndFreezeBundle(bundle, this.#trustPolicy))
    const candidates = frozenBundles.flatMap(bundle => bundle.components.map(component =>
      deepFreeze({
        qualifiedName: `${bundle.namespace}:${component.name}`,
        bundleKey: sourceKey(bundle.source),
        namespace: bundle.namespace,
        source: bundle.source,
        component,
      }),
    ))
    const conflicts = findConflicts(candidates)
    if (conflicts.length > 0) {
      this.#record('reject-conflict', frozenBundles.length, conflicts.length)
      return deepFreeze({ ok: false, revision: this.#revision, conflicts })
    }

    this.#entries = Object.freeze([...candidates].sort((left, right) =>
      compareText(left.qualifiedName, right.qualifiedName)
      || compareText(left.bundleKey, right.bundleKey),
    ))
    this.#activeBundleKeys = new Set(frozenBundles.map(bundle => sourceKey(bundle.source)))
    this.#revision += 1
    this.#record('publish', frozenBundles.length, 0)
    return deepFreeze({ ok: true, snapshot: this.snapshot() })
  }

  acquire(snapshot: ExtensionSnapshot, qualifiedName: string): ExtensionLease {
    const entry = snapshot.entries.find(candidate => candidate.qualifiedName === qualifiedName)
    if (!entry) throw new Error(`extension is not visible in snapshot: ${qualifiedName}`)
    if (!this.#activeBundleKeys.has(entry.bundleKey)) {
      throw new Error(`extension version is no longer active: ${qualifiedName}`)
    }
    const leaseId = ++this.#leaseSequence
    const state = { released: false }
    this.#leases.set(leaseId, state)
    this.#record('acquire', this.#activeBundleKeys.size, 0)
    return Object.freeze({
      bundleKey: entry.bundleKey,
      qualifiedName,
      acquiredRevision: snapshot.revision,
      isValid: () => !state.released,
      release: () => {
        if (state.released) return
        state.released = true
        this.#leases.delete(leaseId)
        this.#record('release', this.#activeBundleKeys.size, 0)
      },
    })
  }

  traces(): readonly ExtensionTrace[] {
    return deepFreeze(this.#trace.map(item => ({ ...item })))
  }

  toCapabilityDefinitions(snapshot: ExtensionSnapshot): readonly CapabilityDefinition[] {
    return deepFreeze(snapshot.entries.map(entry => ({
      name: entry.qualifiedName,
      description: entry.component.description,
      source: 'plugin' as const,
      priority: entry.component.priority ?? 50,
      ...(entry.component.deferred ? { deferred: true } : {}),
    })))
  }

  #record(action: ExtensionTrace['action'], bundleCount: number, conflictCount: number): void {
    this.#trace.push(Object.freeze({ action, revision: this.#revision, bundleCount, conflictCount }))
  }
}

function validateAndFreezeBundle(
  bundle: ExtensionBundle,
  trustPolicy: ExtensionTrustPolicy,
): ExtensionBundle {
  requireIdentifier(bundle.namespace, 'extension namespace')
  for (const [label, value] of Object.entries(bundle.source)) requireText(value, `source ${label}`)
  if (bundle.components.length === 0) throw new Error('extension bundle must contain components')
  trustPolicy.assertAllowed(bundle)
  const names = new Set<string>()
  for (const component of bundle.components) {
    requireIdentifier(component.name, 'component name')
    requireText(component.description, 'component description')
    if (names.has(component.name)) throw new Error(`duplicate component in bundle: ${component.name}`)
    names.add(component.name)
  }
  return deepFreeze(structuredClone(bundle))
}

function findConflicts(entries: readonly RegisteredExtension[]): readonly ExtensionConflict[] {
  const owners = new Map<string, Set<string>>()
  for (const entry of entries) {
    const keys = owners.get(entry.qualifiedName) ?? new Set<string>()
    keys.add(entry.bundleKey)
    owners.set(entry.qualifiedName, keys)
  }
  return deepFreeze([...owners.entries()]
    .filter(([, keys]) => keys.size > 1)
    .map(([qualifiedName, keys]) => ({ qualifiedName, bundleKeys: [...keys].sort(compareText) }))
    .sort((left, right) => compareText(left.qualifiedName, right.qualifiedName)))
}

function sourceKey(source: ExtensionSourceIdentity): string {
  return `${source.marketplace}::${source.locator}::${source.plugin}::${source.version}`
}

function requireIdentifier(value: string, label: string): void {
  requireText(value, label)
  if (!/^[A-Za-z][A-Za-z0-9_.-]*$/.test(value)) {
    throw new Error(`${label} must use the portable ASCII identifier form`)
  }
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty`)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
