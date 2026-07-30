import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { createAgentApplication, shutdownApplication } from './app.ts'
import {
  resolveHarnessSettings,
  resolveProviderCredential,
  type SettingOverrides,
} from './config.ts'
import type { AgentEvent, AgentEventSink, AgentRunSummary } from './runtime.ts'
import { JsonLineTraceSink } from './trace.ts'

type CliOptions = Readonly<{
  prompt?: string
  output: 'text' | 'json' | 'stream-json'
  trace: boolean
  help: boolean
  settings: SettingOverrides
}>

const options = parseArguments(process.argv.slice(2))
if (options.help) {
  stdout.write(helpText())
} else {
  await main(options)
}

async function main(options: CliOptions): Promise<void> {
  let application: ReturnType<typeof createAgentApplication> | undefined
  let exitCode = 0
  try {
    const settings = resolveHarnessSettings(process.env, options.settings)
    const credential = resolveProviderCredential(process.env)
    const mode = options.prompt === undefined ? 'interactive' : 'headless'
    if (mode === 'interactive' && options.output !== 'text') {
      throw new Error('interactive mode supports only --output text')
    }
    const events = eventSink(mode, options.output)
    application = createAgentApplication({
      settings,
      credential,
      mode,
      events,
      traceSinks: options.trace ? [new JsonLineTraceSink()] : [],
    })
    if (options.prompt !== undefined) {
      const summary = await runOne(application.runtime, options.prompt, settings.timeoutMs)
      writeHeadlessSummary(summary, options.output)
      exitCode = summary.status === 'completed' ? 0 : 1
    } else {
      await runInteractive(application.runtime, settings.timeoutMs)
    }
  } catch (error) {
    process.stderr.write(`mini-agent: ${errorMessage(error)}\n`)
    exitCode = 1
  } finally {
    if (application) await shutdownApplication(application, 'cli-finished', exitCode)
    process.exitCode = exitCode
  }
}

async function runOne(
  runtime: ReturnType<typeof createAgentApplication>['runtime'],
  prompt: string,
  timeoutMs: number,
): Promise<AgentRunSummary> {
  const controller = new AbortController()
  const cancel = (): void => controller.abort('SIGINT')
  process.once('SIGINT', cancel)
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(`timeout:${timeoutMs}`), timeoutMs)
    : undefined
  timer?.unref?.()
  try {
    return await runtime.submit(prompt, controller.signal)
  } finally {
    if (timer) clearTimeout(timer)
    process.removeListener('SIGINT', cancel)
  }
}

async function runInteractive(
  runtime: ReturnType<typeof createAgentApplication>['runtime'],
  timeoutMs: number,
): Promise<void> {
  const readline = createInterface({ input: stdin, output: stdout })
  try {
    while (true) {
      const prompt = (await readline.question('mini-agent> ')).trim()
      if (!prompt) continue
      if (prompt === '/exit' || prompt === '/quit') break
      const summary = await runOne(runtime, prompt, timeoutMs)
      if (summary.status !== 'completed') {
        stdout.write(`[${summary.status}${summary.error ? `: ${summary.error}` : ''}]\n`)
      }
    }
  } finally {
    readline.close()
  }
}

function eventSink(
  mode: 'interactive' | 'headless',
  output: CliOptions['output'],
): AgentEventSink | undefined {
  if (mode === 'headless' && output !== 'stream-json') return undefined
  return {
    emit(event: AgentEvent) {
      if (output === 'stream-json') {
        stdout.write(`${JSON.stringify({ type: 'event', event })}\n`)
        return
      }
      switch (event.type) {
        case 'assistant.text':
          stdout.write(`assistant> ${event.text}\n`)
          break
        case 'tool.started':
          stdout.write(`[tool ${event.toolName} started]\n`)
          break
        case 'tool.progress':
          stdout.write(`[tool ${event.toolName} ${event.progress.stage}]\n`)
          break
        case 'tool.finished':
          stdout.write(`[tool ${event.toolName} ${event.status}]\n`)
          break
      }
    },
  }
}

function writeHeadlessSummary(summary: AgentRunSummary, output: CliOptions['output']): void {
  if (output === 'stream-json') {
    stdout.write(`${JSON.stringify({ type: 'summary', summary })}\n`)
  } else if (output === 'json') {
    stdout.write(`${JSON.stringify(summary)}\n`)
  } else if (summary.finalText) {
    stdout.write(`${summary.finalText}\n`)
  } else {
    stdout.write(`${summary.status}${summary.error ? `: ${summary.error}` : ''}\n`)
  }
}

function parseArguments(args: readonly string[]): CliOptions {
  let prompt: string | undefined
  let output: CliOptions['output'] = 'text'
  let trace = false
  let help = false
  const settings: {
    baseUrl?: string
    model?: string
    workspace?: string
    maxTurns?: number
    timeoutMs?: number
    grantedExecutables?: string[]
  } = {}

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    const value = (): string => {
      const next = args[++index]
      if (next === undefined) throw new Error(`${arg} requires a value`)
      return next
    }
    switch (arg) {
      case '--prompt': prompt = value(); break
      case '--output': {
        const candidate = value()
        if (candidate !== 'text' && candidate !== 'json' && candidate !== 'stream-json') {
          throw new Error('--output must be text, json, or stream-json')
        }
        output = candidate
        break
      }
      case '--trace': trace = true; break
      case '--base-url': settings.baseUrl = value(); break
      case '--model': settings.model = value(); break
      case '--workspace': settings.workspace = value(); break
      case '--max-turns': settings.maxTurns = parseInteger(value(), '--max-turns'); break
      case '--timeout-ms': settings.timeoutMs = parseInteger(value(), '--timeout-ms'); break
      case '--grant-executable': (settings.grantedExecutables ??= []).push(value()); break
      case '--help':
      case '-h': help = true; break
      default: throw new Error(`unknown argument: ${arg}`)
    }
  }
  return Object.freeze({
    ...(prompt !== undefined ? { prompt } : {}),
    output,
    trace,
    help,
    settings: Object.freeze(settings),
  })
}

function parseInteger(value: string, name: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} requires a non-negative integer`)
  return Number(value)
}

function helpText(): string {
  return [
    'Mini Agent Harness',
    '',
    'Usage:',
    '  npm run agent -- --prompt "inspect this project" [options]',
    '  npm run agent -- [options]  # interactive',
    '',
    'Options:',
    '  --prompt <text>              Run one headless prompt',
    '  --output text|json|stream-json',
    '  --workspace <path>',
    '  --model <name>',
    '  --base-url <https-url>',
    '  --max-turns <1-32>',
    '  --timeout-ms <0-600000>',
    '  --grant-executable <name>    Grant that executable arbitrary argv (high risk)',
    '  --trace                      Write metadata-only JSONL trace to stderr',
    '',
    'The real provider reads MINI_AGENT_API_KEY from the process environment.',
  ].join('\n') + '\n'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
