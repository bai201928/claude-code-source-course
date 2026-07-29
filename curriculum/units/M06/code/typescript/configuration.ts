export type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | JsonValue[] | JsonObject
export type JsonObject = { [key: string]: JsonValue }

export const SETTING_SOURCE_ORDER = [
  'userSettings',
  'projectSettings',
  'localSettings',
  'flagSettings',
  'policySettings',
] as const

export type SettingSource = (typeof SETTING_SOURCE_ORDER)[number]
export type OrdinarySettingSource = Extract<
  SettingSource,
  'userSettings' | 'projectSettings' | 'localSettings'
>
export type ConfigurationSource = 'pluginSettings' | SettingSource
export type PolicyProviderName = 'remote' | 'mdm' | 'managedFile' | 'hkcu'

export type SourceInput = {
  settings: JsonObject
  valid?: boolean
  error?: string
}

export type PolicyProvider = SourceInput & {
  name: PolicyProviderName
}

export type ConfigurationProvenance = {
  leaves: Readonly<Record<string, ConfigurationSource>>
  arrayItems: Readonly<Record<string, ConfigurationSource>>
}

export type ConfigurationSnapshot = {
  revision: number
  effective: Readonly<JsonObject>
  provenance: ConfigurationProvenance
  sourceOrder: readonly SettingSource[]
  sourceSettings: Readonly<Partial<Record<SettingSource, Readonly<JsonObject>>>>
  policyProvider: PolicyProviderName | null
  errors: readonly string[]
}

export type ResolveConfigurationInput = {
  revision: number
  selectedOrdinarySources?: readonly OrdinarySettingSource[]
  orderMode?: 'canonical' | 'snapshot-compatible'
  sourceOrder?: readonly SettingSource[]
  pluginSettings?: SourceInput
  sources?: Partial<Record<SettingSource, SourceInput>>
  flagInline?: SourceInput
  policyProviders?: readonly PolicyProvider[]
}

export const DEFAULT_SAFE_ENV_VARS = new Set([
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
])

export function deriveCanonicalOrder(
  selected?: readonly OrdinarySettingSource[],
): SettingSource[] {
  const enabled = selected === undefined ? null : new Set(selected)
  return SETTING_SOURCE_ORDER.filter(
    source =>
      source === 'flagSettings' ||
      source === 'policySettings' ||
      enabled === null ||
      enabled.has(source),
  )
}

// Reproduces this source snapshot's Set insertion behavior for study and tests.
export function deriveSnapshotCompatibleOrder(
  selected?: readonly OrdinarySettingSource[],
): SettingSource[] {
  if (selected === undefined) return [...SETTING_SOURCE_ORDER]
  const result = new Set<SettingSource>(selected)
  result.add('policySettings')
  result.add('flagSettings')
  return [...result]
}

export function resolveConfiguration(
  input: ResolveConfigurationInput,
): ConfigurationSnapshot {
  const errors: string[] = []
  const leaves: Record<string, ConfigurationSource> = {}
  const arrayItems: Record<string, ConfigurationSource> = {}
  const effective: JsonObject = {}
  const sourceSettings: Partial<Record<SettingSource, JsonObject>> = {}

  const order = uniqueSources(
    input.sourceOrder ??
      (input.orderMode === 'snapshot-compatible'
        ? deriveSnapshotCompatibleOrder(input.selectedOrdinarySources)
        : deriveCanonicalOrder(input.selectedOrdinarySources)),
  )
  requireMandatorySources(order)

  const plugin = validSource(input.pluginSettings, 'pluginSettings', errors)
  if (plugin) {
    mergeObject(effective, plugin, 'pluginSettings', '', leaves, arrayItems)
  }

  const selectedPolicy = selectPolicyProvider(input.policyProviders ?? [], errors)

  for (const source of order) {
    let settings: JsonObject | undefined
    if (source === 'policySettings') {
      settings = selectedPolicy?.settings
    } else if (source === 'flagSettings') {
      settings = combineFlagSettings(
        input.sources?.flagSettings,
        input.flagInline,
        errors,
      )
    } else {
      settings = validSource(input.sources?.[source], source, errors)
    }
    if (!settings || Object.keys(settings).length === 0) continue
    sourceSettings[source] = cloneJson(settings) as JsonObject
    mergeObject(effective, settings, source, '', leaves, arrayItems)
  }

  return deepFreeze({
    revision: input.revision,
    effective: cloneJson(effective) as JsonObject,
    provenance: {
      leaves: { ...leaves },
      arrayItems: { ...arrayItems },
    },
    sourceOrder: [...order],
    sourceSettings: cloneJson(sourceSettings as JsonObject) as Partial<
      Record<SettingSource, JsonObject>
    >,
    policyProvider: selectedPolicy?.name ?? null,
    errors: [...errors],
  })
}

export function projectEnvironment(
  snapshot: ConfigurationSnapshot,
  phase: 'pre-trust' | 'trusted',
  safeEnvVars: ReadonlySet<string> = DEFAULT_SAFE_ENV_VARS,
): Record<string, string> {
  if (phase === 'trusted') return readStringEnv(snapshot.effective)

  const result: Record<string, string> = {}
  for (const source of [
    'userSettings',
    'flagSettings',
    'policySettings',
  ] as const) {
    Object.assign(result, readStringEnv(snapshot.sourceSettings[source]))
  }

  const effectiveEnv = readStringEnv(snapshot.effective)
  for (const [key, value] of Object.entries(effectiveEnv)) {
    if (safeEnvVars.has(key.toUpperCase())) result[key] = value
  }
  return result
}

export function assertEditableSource(
  source: SettingSource,
): asserts source is OrdinarySettingSource {
  if (source === 'flagSettings' || source === 'policySettings') {
    throw new Error(`${source} is read-only inside the harness`)
  }
}

function combineFlagSettings(
  file: SourceInput | undefined,
  inline: SourceInput | undefined,
  errors: string[],
): JsonObject | undefined {
  const fileSettings = validSource(file, 'flagSettings file', errors)
  const inlineSettings = validSource(inline, 'flagSettings inline', errors)
  if (!fileSettings && !inlineSettings) return undefined
  const combined: JsonObject = {}
  const leaves: Record<string, ConfigurationSource> = {}
  const items: Record<string, ConfigurationSource> = {}
  if (fileSettings) {
    mergeObject(combined, fileSettings, 'flagSettings', '', leaves, items)
  }
  if (inlineSettings) {
    mergeObject(combined, inlineSettings, 'flagSettings', '', leaves, items)
  }
  return combined
}

function selectPolicyProvider(
  providers: readonly PolicyProvider[],
  errors: string[],
): PolicyProvider | undefined {
  for (const provider of providers) {
    if (provider.valid === false) {
      errors.push(provider.error ?? `${provider.name} policy is invalid`)
      continue
    }
    if (Object.keys(provider.settings).length > 0) return provider
  }
  return undefined
}

function validSource(
  input: SourceInput | undefined,
  label: string,
  errors: string[],
): JsonObject | undefined {
  if (!input) return undefined
  if (input.valid === false) {
    errors.push(input.error ?? `${label} settings are invalid`)
    return undefined
  }
  return input.settings
}

function mergeObject(
  target: JsonObject,
  incoming: JsonObject,
  source: ConfigurationSource,
  prefix: string,
  leaves: Record<string, ConfigurationSource>,
  arrayItems: Record<string, ConfigurationSource>,
): void {
  for (const [key, value] of Object.entries(incoming)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (Array.isArray(value)) {
      let output: JsonValue[]
      if (Array.isArray(target[key])) {
        output = target[key] as JsonValue[]
      } else {
        clearPath(path, leaves, arrayItems)
        output = []
      }
      for (const item of value) {
        if (output.some(existing => sameValueZero(existing, item))) continue
        const index = output.length
        output.push(cloneJson(item))
        arrayItems[`${path}[${index}]`] = source
      }
      target[key] = output
      continue
    }
    if (isJsonObject(value)) {
      if (!isJsonObject(target[key])) {
        clearPath(path, leaves, arrayItems)
        target[key] = {}
      }
      mergeObject(
        target[key] as JsonObject,
        value,
        source,
        path,
        leaves,
        arrayItems,
      )
      continue
    }
    clearPath(path, leaves, arrayItems)
    target[key] = value
    leaves[path] = source
  }
}

function clearPath(
  prefix: string,
  leaves: Record<string, ConfigurationSource>,
  arrayItems: Record<string, ConfigurationSource>,
): void {
  for (const key of Object.keys(leaves)) {
    if (belongsToPath(key, prefix)) delete leaves[key]
  }
  for (const key of Object.keys(arrayItems)) {
    if (belongsToPath(key, prefix)) delete arrayItems[key]
  }
}

function belongsToPath(candidate: string, prefix: string): boolean {
  return (
    candidate === prefix ||
    candidate.startsWith(`${prefix}.`) ||
    candidate.startsWith(`${prefix}[`)
  )
}

function readStringEnv(
  settings: Readonly<JsonObject> | undefined,
): Record<string, string> {
  if (!settings) return {}
  const env = settings.env
  if (!isJsonObject(env)) return {}
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

function uniqueSources(sources: readonly SettingSource[]): SettingSource[] {
  return [...new Set(sources)]
}

function requireMandatorySources(sources: readonly SettingSource[]): void {
  for (const mandatory of ['flagSettings', 'policySettings'] as const) {
    if (!sources.includes(mandatory)) {
      throw new Error(`${mandatory} must be present in the source order`)
    }
  }
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameValueZero(left: JsonValue, right: JsonValue): boolean {
  return left === right || (left !== left && right !== right)
}

function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => cloneJson(item)) as T
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
    ) as T
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

