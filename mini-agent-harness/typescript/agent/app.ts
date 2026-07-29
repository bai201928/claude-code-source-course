import { CapabilityCatalog } from '../capabilityProjection.ts'
import { resolveConfiguration } from '../configuration.ts'
import { LifecycleCoordinator } from '../lifecycleCoordinator.ts'
import {
  createRuntimeContext,
  createSessionStateStore,
} from '../runtimeContext.ts'
import type { HarnessSettings, ProviderCredential } from './config.ts'
import { OpenAICompatibleAdapter } from './openaiCompatibleAdapter.ts'
import { PolicyPermissionGate } from './permissions.ts'
import {
  AgentRuntime,
  type AgentEventSink,
  type AgentRuntimeOptions,
} from './runtime.ts'
import { TraceRecorder, type TraceSink } from './trace.ts'
import { AgentToolRegistry, createBuiltinTools } from './tools.ts'

export type AgentApplication = Readonly<{
  runtime: AgentRuntime
  lifecycle: LifecycleCoordinator
  configurationRevision: number
}>

export function createAgentApplication(input: {
  settings: HarnessSettings
  credential: ProviderCredential
  mode: 'interactive' | 'headless'
  traceSinks?: readonly TraceSink[]
  events?: AgentEventSink
  runtimeOverrides?: Partial<
    Pick<AgentRuntimeOptions, 'model' | 'permissionGate' | 'ids' | 'conversation'>
  >
}): AgentApplication {
  const configuration = resolveConfiguration({
    revision: 1,
    sources: {
      flagSettings: {
        settings: {
          provider: 'openai-compatible',
          model: input.settings.model,
          baseUrl: input.settings.baseUrl,
          workspace: input.settings.workspace,
          maxTurns: input.settings.maxTurns,
          timeoutMs: input.settings.timeoutMs,
          grantedExecutables: [...input.settings.grantedExecutables],
          credential: { configured: true, source: input.credential.source },
        },
      },
    },
  })
  const model = input.runtimeOverrides?.model ?? new OpenAICompatibleAdapter({
    apiKey: input.credential.apiKey,
    baseUrl: input.settings.baseUrl,
    model: input.settings.model,
  })
  const runtimeContext = createRuntimeContext({
    runtimeId: `runtime-${Date.now()}`,
    configurationRevision: configuration.revision,
    modelAdapter: model.provider,
  })
  const sessionState = createSessionStateStore({ mode: input.mode })
  const registry = new AgentToolRegistry()
  for (const tool of createBuiltinTools(input.settings.workspace)) registry.register(tool)
  const catalog = new CapabilityCatalog()
  catalog.publish(registry.names().map(name => Object.freeze({
    name,
    description: `Built-in ${name} capability`,
    source: 'builtin' as const,
    priority: 100,
  })))
  const trace = new TraceRecorder(input.traceSinks ?? [])
  const lifecycle = new LifecycleCoordinator()
  lifecycle.register('trace.flush', 'critical', async () => trace.flush())
  const runtime = new AgentRuntime({
    model,
    tools: registry,
    permissionGate: input.runtimeOverrides?.permissionGate ??
      new PolicyPermissionGate(input.settings.grantedExecutables),
    catalog,
    runtimeContext,
    sessionState,
    workspace: input.settings.workspace,
    mode: input.mode,
    maxTurns: input.settings.maxTurns,
    trace,
    events: input.events,
    ids: input.runtimeOverrides?.ids,
    conversation: input.runtimeOverrides?.conversation,
    systemPrompt: [
      'You are a focused coding agent working inside a configured workspace.',
      'Inspect before acting. Use read-only tools first.',
      'Command execution is unavailable unless the operator explicitly grants an executable.',
    ].join(' '),
  })
  return Object.freeze({
    runtime,
    lifecycle,
    configurationRevision: configuration.revision,
  })
}

export async function shutdownApplication(
  application: AgentApplication,
  reason: string,
  exitCode: number,
): Promise<void> {
  await application.lifecycle.shutdown({
    reason,
    exitCode,
    overallBudgetMs: 2_000,
    tierBudgetMs: {
      critical: 1_000,
      resource: 600,
      'best-effort': 300,
    },
  })
}
