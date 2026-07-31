import path from 'node:path'

export type InstructionSourceKind = 'managed' | 'user' | 'project' | 'local' | 'dynamic'
export type InstructionTrust = 'trusted' | 'approved' | 'untrusted'

export type InstructionSource = Readonly<{
  id: string
  kind: InstructionSourceKind
  filePath: string
  scopeRoot: string
  pathPrefixes?: readonly string[]
  trust: InstructionTrust
  content: string
}>

export type InstructionCatalogSnapshot = Readonly<{
  revision: number
  sources: readonly InstructionSource[]
}>

export type InstructionProjectionReport = Readonly<{
  catalogRevision: number
  discoveredCount: number
  selectedCount: number
  deduplicatedCount: number
  outOfScopeCount: number
  untrustedCount: number
  dynamicCount: number
  sourceIds: readonly string[]
}>

export type InstructionSnapshot = Readonly<{
  catalogRevision: number
  targetPath: string
  instructions: readonly Readonly<{
    id: string
    kind: InstructionSourceKind
    filePath: string
    content: string
  }>[]
  report: InstructionProjectionReport
}>

export class InstructionInvariantError extends Error {}
export class StaleInstructionRevisionError extends Error {}

export class InstructionCatalog {
  #revision = 0
  #sources: readonly InstructionSource[]

  constructor(sources: readonly InstructionSource[] = []) {
    this.#sources = validateAndFreezeSources(sources)
  }

  get revision(): number { return this.#revision }

  snapshot(): InstructionCatalogSnapshot {
    return deepFreeze({ revision: this.#revision, sources: this.#sources })
  }

  publish(expectedRevision: number, sources: readonly InstructionSource[]): InstructionCatalogSnapshot {
    if (expectedRevision !== this.#revision) {
      throw new StaleInstructionRevisionError(
        `stale instruction revision ${expectedRevision}; current=${this.#revision}`,
      )
    }
    this.#sources = validateAndFreezeSources(sources)
    this.#revision += 1
    return this.snapshot()
  }

  assertCurrent(revision: number): void {
    if (revision !== this.#revision) {
      throw new StaleInstructionRevisionError(
        `stale instruction projection ${revision}; current=${this.#revision}`,
      )
    }
  }
}

export class InstructionPipeline {
  project(
    catalog: InstructionCatalogSnapshot,
    targetPath: string,
    dynamicSources: readonly InstructionSource[] = [],
  ): InstructionSnapshot {
    const normalizedTarget = normalizeAbsolute(targetPath, 'target path')
    if (dynamicSources.some(source => source.kind !== 'dynamic')) {
      throw new InstructionInvariantError('request-only sources must use kind=dynamic')
    }
    const candidates = validateAndFreezeSources([
      ...catalog.sources,
      ...dynamicSources,
    ])
    let outOfScopeCount = 0
    let untrustedCount = 0
    const selected: InstructionSource[] = []
    for (const source of candidates) {
      if (source.trust === 'untrusted') {
        untrustedCount += 1
        continue
      }
      if (!appliesTo(source, normalizedTarget)) {
        outOfScopeCount += 1
        continue
      }
      selected.push(source)
    }

    const byPath = new Map<string, InstructionSource>()
    for (const source of selected.sort(compareSources)) {
      byPath.set(normalizeAbsolute(source.filePath, 'instruction path'), source)
    }
    const ordered = [...byPath.values()].sort(compareSources)
    return deepFreeze({
      catalogRevision: catalog.revision,
      targetPath: normalizedTarget,
      instructions: ordered.map(source => ({
        id: source.id,
        kind: source.kind,
        filePath: source.filePath,
        content: source.content,
      })),
      report: {
        catalogRevision: catalog.revision,
        discoveredCount: candidates.length,
        selectedCount: ordered.length,
        deduplicatedCount: selected.length - ordered.length,
        outOfScopeCount,
        untrustedCount,
        dynamicCount: ordered.filter(source => source.kind === 'dynamic').length,
        sourceIds: ordered.map(source => source.id),
      },
    })
  }
}

function appliesTo(source: InstructionSource, target: string): boolean {
  const root = normalizeAbsolute(source.scopeRoot, 'scope root')
  const relative = path.relative(root, target).replaceAll('\\', '/')
  if (!relative || relative === '.') return !source.pathPrefixes?.length
  if (relative.startsWith('../') || path.isAbsolute(relative)) return false
  if (!source.pathPrefixes?.length) return true
  return source.pathPrefixes.some(prefix => {
    const normalized = normalizeRelative(prefix)
    return relative === normalized || relative.startsWith(`${normalized}/`)
  })
}

function compareSources(left: InstructionSource, right: InstructionSource): number {
  return KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || pathDepth(left.scopeRoot) - pathDepth(right.scopeRoot)
    || normalizeAbsolute(left.filePath, 'instruction path')
      .localeCompare(normalizeAbsolute(right.filePath, 'instruction path'))
    || left.id.localeCompare(right.id)
}

const KIND_ORDER: Readonly<Record<InstructionSourceKind, number>> = Object.freeze({
  managed: 0,
  user: 1,
  project: 2,
  local: 3,
  dynamic: 4,
})

function validateAndFreezeSources(sources: readonly InstructionSource[]): readonly InstructionSource[] {
  const ids = new Set<string>()
  return deepFreeze(sources.map(source => {
    requireText(source.id, 'instruction id')
    requireText(source.content, 'instruction content')
    normalizeAbsolute(source.filePath, 'instruction path')
    normalizeAbsolute(source.scopeRoot, 'scope root')
    if (ids.has(source.id)) throw new InstructionInvariantError(`duplicate instruction id: ${source.id}`)
    ids.add(source.id)
    return structuredClone(source)
  }))
}

function normalizeAbsolute(value: string, label: string): string {
  requireText(value, label)
  if (!path.isAbsolute(value)) throw new InstructionInvariantError(`${label} must be absolute`)
  return path.resolve(value).replaceAll('\\', '/').toLowerCase()
}

function normalizeRelative(value: string): string {
  requireText(value, 'path prefix')
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '')
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) {
    throw new InstructionInvariantError('path prefix must stay relative to scope root')
  }
  return normalized.toLowerCase()
}

function pathDepth(value: string): number {
  return normalizeAbsolute(value, 'scope root').split('/').filter(Boolean).length
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new InstructionInvariantError(`${label} must not be empty`)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}
