export type CapabilitySource =
  | 'builtin'
  | 'plugin'
  | 'mcp'
  | 'dynamic'
  | 'policy'

export type CapabilityDefinition = Readonly<{
  name: string
  description: string
  source: CapabilitySource
  priority: number
  deferred?: boolean
  modes?: readonly string[]
  providers?: readonly string[]
  models?: readonly string[]
}>

export type CatalogSnapshot = Readonly<{
  revision: number
  capabilities: readonly CapabilityDefinition[]
}>

export class CapabilityCatalog {
  #revision = 0
  #capabilities = new Map<string, CapabilityDefinition>()

  publish(definitions: readonly CapabilityDefinition[]): CatalogSnapshot {
    const next = new Map(this.#capabilities)
    for (const definition of definitions) {
      validateCapability(definition)
      const candidate = freezeCapability(definition)
      const current = next.get(candidate.name)
      if (!current || candidate.priority > current.priority) {
        next.set(candidate.name, candidate)
      }
    }
    this.#capabilities = next
    this.#revision += 1
    return this.snapshot()
  }

  snapshot(): CatalogSnapshot {
    const capabilities = [...this.#capabilities.values()]
      .sort((left, right) => compareAsciiNames(left.name, right.name))
      .map(freezeCapability)
    return Object.freeze({
      revision: this.#revision,
      capabilities: Object.freeze(capabilities),
    })
  }
}

export type ProjectionReason =
  | 'included'
  | 'hidden-by-policy'
  | 'mode-mismatch'
  | 'provider-mismatch'
  | 'model-mismatch'
  | 'deferred-until-discovered'

export type ProjectionDecision = Readonly<{
  name: string
  source: CapabilitySource
  included: boolean
  reason: ProjectionReason
}>

export type ToolSchema = Readonly<{
  name: string
  description: string
  source: CapabilitySource
}>

export type CapabilitySnapshot = Readonly<{
  catalogRevision: number
  boundary: string
  mode: string
  provider: string
  model: string
  schemas: readonly ToolSchema[]
  decisions: readonly ProjectionDecision[]
}>

export type ProjectionOptions = Readonly<{
  boundary: string
  mode: string
  provider: string
  model: string
  policyHiddenNames?: ReadonlySet<string>
  discoveredDeferredNames?: ReadonlySet<string>
}>

export class CapabilityProjector {
  project(
    catalog: CatalogSnapshot,
    options: ProjectionOptions,
  ): CapabilitySnapshot {
    requireNonEmpty(options.boundary, 'boundary')
    requireNonEmpty(options.mode, 'mode')
    requireNonEmpty(options.provider, 'provider')
    requireNonEmpty(options.model, 'model')

    const decisions = catalog.capabilities.map(capability =>
      decideProjection(capability, options),
    )
    const schemas = catalog.capabilities
      .filter((_, index) => decisions[index]?.included)
      .map(capability =>
        Object.freeze({
          name: capability.name,
          description: capability.description,
          source: capability.source,
        }),
      )

    return Object.freeze({
      catalogRevision: catalog.revision,
      boundary: options.boundary,
      mode: options.mode,
      provider: options.provider,
      model: options.model,
      schemas: Object.freeze(schemas),
      decisions: Object.freeze(decisions),
    })
  }
}

export type ExecutableHandler = (input: unknown) => unknown

export class ExecutableRegistry {
  #handlers = new Map<string, ExecutableHandler>()

  register(name: string, handler: ExecutableHandler): void {
    requireNonEmpty(name, 'tool name')
    if (this.#handlers.has(name)) {
      throw new Error(`executable already registered: ${name}`)
    }
    this.#handlers.set(name, handler)
  }

  names(): readonly string[] {
    return Object.freeze([...this.#handlers.keys()].sort(compareAsciiNames))
  }

  dispatch(snapshot: CapabilitySnapshot, name: string, input: unknown): unknown {
    if (!snapshot.schemas.some(schema => schema.name === name)) {
      throw new Error(`tool is not visible in boundary ${snapshot.boundary}: ${name}`)
    }
    const handler = this.#handlers.get(name)
    if (!handler) {
      throw new Error(`visible tool has no executable handler: ${name}`)
    }
    return handler(input)
  }
}

export type BuiltSystemContext = Readonly<{
  systemPrompt: readonly string[]
  metaUserContext: Readonly<Record<string, string>>
  systemContext: Readonly<Record<string, string>>
  base: 'default' | 'custom'
}>

export class SystemContextBuilder {
  build(input: {
    defaultPrompt: readonly string[]
    customPrompt?: string
    appendPrompt?: string
    userContext?: Readonly<Record<string, string>>
    systemContext?: Readonly<Record<string, string>>
  }): BuiltSystemContext {
    const customPrompt = input.customPrompt?.trim()
    const appendPrompt = input.appendPrompt?.trim()
    const base = customPrompt ? [customPrompt] : [...input.defaultPrompt]
    const systemPrompt = appendPrompt ? [...base, appendPrompt] : base
    if (systemPrompt.length === 0) {
      throw new Error('an effective system prompt is required')
    }
    return Object.freeze({
      systemPrompt: Object.freeze(systemPrompt),
      metaUserContext: Object.freeze({ ...(input.userContext ?? {}) }),
      systemContext: Object.freeze({ ...(input.systemContext ?? {}) }),
      base: customPrompt ? 'custom' : 'default',
    })
  }
}

function decideProjection(
  capability: CapabilityDefinition,
  options: ProjectionOptions,
): ProjectionDecision {
  let reason: ProjectionReason = 'included'
  if (options.policyHiddenNames?.has(capability.name)) {
    reason = 'hidden-by-policy'
  } else if (capability.modes && !capability.modes.includes(options.mode)) {
    reason = 'mode-mismatch'
  } else if (
    capability.providers &&
    !capability.providers.includes(options.provider)
  ) {
    reason = 'provider-mismatch'
  } else if (capability.models && !capability.models.includes(options.model)) {
    reason = 'model-mismatch'
  } else if (
    capability.deferred &&
    !options.discoveredDeferredNames?.has(capability.name)
  ) {
    reason = 'deferred-until-discovered'
  }
  return Object.freeze({
    name: capability.name,
    source: capability.source,
    included: reason === 'included',
    reason,
  })
}

function freezeCapability(
  definition: CapabilityDefinition,
): CapabilityDefinition {
  return Object.freeze({
    ...definition,
    ...(definition.modes ? { modes: Object.freeze([...definition.modes]) } : {}),
    ...(definition.providers
      ? { providers: Object.freeze([...definition.providers]) }
      : {}),
    ...(definition.models
      ? { models: Object.freeze([...definition.models]) }
      : {}),
  })
}

function validateCapability(definition: CapabilityDefinition): void {
  requireNonEmpty(definition.name, 'capability name')
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(definition.name)) {
    throw new Error('capability name must use the portable ASCII identifier form')
  }
  requireNonEmpty(definition.description, 'capability description')
  if (!Number.isFinite(definition.priority)) {
    throw new Error('capability priority must be finite')
  }
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim() === '') throw new Error(`${name} must not be empty`)
}

function compareAsciiNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
