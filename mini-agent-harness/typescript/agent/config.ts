import path from 'node:path'

export type HarnessSettings = Readonly<{
  baseUrl: string
  model: string
  workspace: string
  maxTurns: number
  timeoutMs: number
  grantedExecutables: readonly string[]
}>

export type ProviderCredential = Readonly<{
  apiKey: string
  source: 'environment'
}>

export type SettingOverrides = Readonly<{
  baseUrl?: string
  model?: string
  workspace?: string
  maxTurns?: number
  timeoutMs?: number
  grantedExecutables?: readonly string[]
}>

export function resolveHarnessSettings(
  env: NodeJS.ProcessEnv,
  overrides: SettingOverrides = {},
): HarnessSettings {
  const grantedExecutables = overrides.grantedExecutables ??
    splitList(env.MINI_AGENT_GRANTED_EXECUTABLES)
  return Object.freeze({
    baseUrl: nonEmpty(
      overrides.baseUrl ?? env.MINI_AGENT_BASE_URL ?? 'https://api.deepseek.com/v1',
      'base URL',
    ),
    model: nonEmpty(
      overrides.model ?? env.MINI_AGENT_MODEL ?? 'deepseek-v4-flash',
      'model',
    ),
    workspace: path.resolve(
      nonEmpty(overrides.workspace ?? env.MINI_AGENT_WORKSPACE ?? process.cwd(), 'workspace'),
    ),
    maxTurns: boundedInteger(
      overrides.maxTurns ?? parseOptionalInteger(env.MINI_AGENT_MAX_TURNS, 'MINI_AGENT_MAX_TURNS') ?? 8,
      'max turns',
      1,
      32,
    ),
    timeoutMs: boundedInteger(
      overrides.timeoutMs ?? parseOptionalInteger(env.MINI_AGENT_TIMEOUT_MS, 'MINI_AGENT_TIMEOUT_MS') ?? 0,
      'timeout',
      0,
      600_000,
    ),
    grantedExecutables: Object.freeze([
      ...new Set(grantedExecutables.map(item => item.trim()).filter(Boolean)),
    ]),
  })
}

export function resolveProviderCredential(env: NodeJS.ProcessEnv): ProviderCredential {
  const apiKey = env.MINI_AGENT_API_KEY
  if (!apiKey?.trim()) {
    throw new Error('MINI_AGENT_API_KEY is required for the real provider')
  }
  return Object.freeze({ apiKey, source: 'environment' })
}

function splitList(value: string | undefined): string[] {
  return value?.split(',').map(item => item.trim()).filter(Boolean) ?? []
}

function parseOptionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be a non-negative integer`)
  return Number(value)
}

function boundedInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`)
  }
  return value
}

function nonEmpty(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} must not be empty`)
  return value
}
