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
  #definitions = new Map<string, CapabilityDefinition>()

  publish(definitions: readonly CapabilityDefinition[]): CatalogSnapshot {
    const next = new Map(this.#definitions)
    for (const definition of definitions) {
      validateDefinition(definition)
      const current = next.get(definition.name)
      if (!current || definition.priority > current.priority) {
        next.set(definition.name, freezeDefinition(definition))
      }
    }
    this.#definitions = next
    this.#revision += 1
    return this.snapshot()
  }

  snapshot(): CatalogSnapshot {
    const capabilities = [...this.#definitions.values()]
      .sort((left, right) => compareNames(left.name, right.name))
      .map(freezeDefinition)
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

export type CapabilitySnapshot = Readonly<{
  catalogRevision: number
  boundary: string
  mode: string
  provider: string
  model: string
  schemas: readonly Readonly<{
    name: string
    description: string
    source: CapabilitySource
  }>[]
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
  project(catalog: CatalogSnapshot, options: ProjectionOptions): CapabilitySnapshot {
    requireNonEmpty(options.boundary, 'boundary')
    requireNonEmpty(options.mode, 'mode')
    requireNonEmpty(options.provider, 'provider')
    requireNonEmpty(options.model, 'model')
    const decisions = catalog.capabilities.map(definition =>
      decide(definition, options),
    )
    const schemas = catalog.capabilities
      .filter((_, index) => decisions[index]?.included)
      .map(definition =>
        Object.freeze({
          name: definition.name,
          description: definition.description,
          source: definition.source,
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

export class ExecutableRegistry {
  #handlers = new Map<string, (input: unknown) => unknown>()

  register(name: string, handler: (input: unknown) => unknown): void {
    requireNonEmpty(name, 'tool name')
    if (this.#handlers.has(name)) throw new Error(`executable already registered: ${name}`)
    this.#handlers.set(name, handler)
  }

  names(): readonly string[] {
    return Object.freeze([...this.#handlers.keys()].sort(compareNames))
  }

  dispatch(snapshot: CapabilitySnapshot, name: string, input: unknown): unknown {
    if (!snapshot.schemas.some(schema => schema.name === name)) {
      throw new Error(`tool is not visible in boundary ${snapshot.boundary}: ${name}`)
    }
    const handler = this.#handlers.get(name)
    if (!handler) throw new Error(`visible tool has no executable handler: ${name}`)
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
    const custom = input.customPrompt?.trim()
    const appended = input.appendPrompt?.trim()
    const base = custom ? [custom] : [...input.defaultPrompt]
    const effective = appended ? [...base, appended] : base
    if (effective.length === 0) throw new Error('an effective system prompt is required')
    return Object.freeze({
      systemPrompt: Object.freeze(effective),
      metaUserContext: Object.freeze({ ...(input.userContext ?? {}) }),
      systemContext: Object.freeze({ ...(input.systemContext ?? {}) }),
      base: custom ? 'custom' : 'default',
    })
  }
}

function decide(
  definition: CapabilityDefinition,
  options: ProjectionOptions,
): ProjectionDecision {
  let reason: ProjectionReason = 'included'
  if (options.policyHiddenNames?.has(definition.name)) reason = 'hidden-by-policy'
  else if (definition.modes && !definition.modes.includes(options.mode)) reason = 'mode-mismatch'
  else if (definition.providers && !definition.providers.includes(options.provider)) reason = 'provider-mismatch'
  else if (definition.models && !definition.models.includes(options.model)) reason = 'model-mismatch'
  else if (definition.deferred && !options.discoveredDeferredNames?.has(definition.name)) {
    reason = 'deferred-until-discovered'
  }
  return Object.freeze({
    name: definition.name,
    source: definition.source,
    included: reason === 'included',
    reason,
  })
}

function freezeDefinition(definition: CapabilityDefinition): CapabilityDefinition {
  return Object.freeze({
    ...definition,
    ...(definition.modes ? { modes: Object.freeze([...definition.modes]) } : {}),
    ...(definition.providers ? { providers: Object.freeze([...definition.providers]) } : {}),
    ...(definition.models ? { models: Object.freeze([...definition.models]) } : {}),
  })
}

function validateDefinition(definition: CapabilityDefinition): void {
  requireNonEmpty(definition.name, 'capability name')
  requireNonEmpty(definition.description, 'capability description')
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(definition.name)) {
    throw new Error('capability name must use the portable ASCII identifier form')
  }
  if (!Number.isFinite(definition.priority)) throw new Error('capability priority must be finite')
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim() === '') throw new Error(`${name} must not be empty`)
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
