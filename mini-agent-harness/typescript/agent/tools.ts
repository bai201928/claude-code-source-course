import { spawn } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ModelToolDefinition } from './model.ts'
import {
  PermissionDeniedError,
  type PermissionDecision,
  type PermissionGate,
  type PermissionRequest,
  type ToolRisk,
} from './permissions.ts'

export type ToolContext = Readonly<{
  workspace: string
  signal: AbortSignal
}>

export type AgentTool = Readonly<{
  name: string
  description: string
  inputSchema: Readonly<Record<string, unknown>>
  risk: ToolRisk
  permissionRequest(input: Readonly<Record<string, unknown>>): PermissionRequest
  execute(input: Readonly<Record<string, unknown>>, context: ToolContext): Promise<unknown>
}>

export type ToolDispatchResult = Readonly<{
  decision: PermissionDecision
  output: unknown
}>

export class ToolInputError extends Error {}
export class ToolExecutionError extends Error {}

export class AgentToolRegistry {
  readonly #tools = new Map<string, AgentTool>()

  register(tool: AgentTool): void {
    requireIdentifier(tool.name, 'tool name')
    if (this.#tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`)
    this.#tools.set(tool.name, tool)
  }

  names(): readonly string[] {
    return Object.freeze([...this.#tools.keys()].sort(compareNames))
  }

  definitions(visibleNames: ReadonlySet<string>): readonly ModelToolDefinition[] {
    return Object.freeze(
      this.names()
        .filter(name => visibleNames.has(name))
        .map(name => {
          const tool = this.#tools.get(name)!
          return Object.freeze({
            name: tool.name,
            description: tool.description,
            inputSchema: structuredClone(tool.inputSchema),
          })
        }),
    )
  }

  async dispatch(
    name: string,
    input: Readonly<Record<string, unknown>>,
    context: ToolContext,
    gate: PermissionGate,
    visibleNames: ReadonlySet<string>,
  ): Promise<ToolDispatchResult> {
    throwIfAborted(context.signal)
    if (!visibleNames.has(name)) throw new ToolExecutionError(`tool is not visible: ${name}`)
    const tool = this.#tools.get(name)
    if (!tool) throw new ToolExecutionError(`visible tool has no executable handler: ${name}`)
    const decision = Object.freeze(await abortableDecision(
      gate.decide(tool.permissionRequest(input), context.signal),
      context.signal,
    ))
    if (!decision.allowed) throw new PermissionDeniedError(decision)
    throwIfAborted(context.signal)
    const output = await tool.execute(input, context)
    throwIfAborted(context.signal)
    return Object.freeze({
      decision,
      output,
    })
  }
}

export function createBuiltinTools(workspace: string): readonly AgentTool[] {
  const guard = new WorkspaceGuard(workspace)
  const rgExecutable = resolveTrustedPathExecutable('rg', guard.root)
  return Object.freeze([
    createReadFileTool(guard),
    createListFilesTool(guard, rgExecutable),
    createSearchTextTool(guard, rgExecutable),
    createRunCommandTool(guard),
  ])
}

class WorkspaceGuard {
  readonly root: string

  constructor(root: string) {
    if (!root.trim()) throw new Error('workspace must not be empty')
    this.root = path.resolve(root)
  }

  async resolveExisting(candidate = '.'): Promise<string> {
    const lexical = path.resolve(this.root, candidate)
    assertInside(this.root, lexical)
    const [realRoot, realCandidate] = await Promise.all([
      realpath(this.root),
      realpath(lexical),
    ])
    assertInside(realRoot, realCandidate)
    return realCandidate
  }
}

function createReadFileTool(guard: WorkspaceGuard): AgentTool {
  const tool: AgentTool = {
    name: 'read_file',
    description: 'Read a bounded line range from a UTF-8 file inside the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        start_line: { type: 'integer', minimum: 1 },
        max_lines: { type: 'integer', minimum: 1, maximum: 400 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    risk: 'read',
    permissionRequest: () => ({ toolName: 'read_file', risk: 'read' }),
    async execute(input, context) {
      throwIfAborted(context.signal)
      const requestedPath = requireString(input.path, 'path')
      const startLine = optionalInteger(input.start_line, 'start_line', 1, 1, Number.MAX_SAFE_INTEGER)
      const maxLines = optionalInteger(input.max_lines, 'max_lines', 200, 1, 400)
      const file = await guard.resolveExisting(requestedPath)
      const metadata = await stat(file)
      if (!metadata.isFile()) throw new ToolInputError('path must identify a file')
      assertReadableFile(file)
      if (metadata.size > 2 * 1024 * 1024) {
        throw new ToolInputError('file exceeds the 2 MiB teaching harness limit')
      }
      const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
      const selected = lines.slice(startLine - 1, startLine - 1 + maxLines)
      return selected
        .map((line, index) => `${startLine + index}: ${line}`)
        .join('\n')
    },
  }
  return Object.freeze(tool)
}

function createListFilesTool(guard: WorkspaceGuard, rgExecutable: string): AgentTool {
  const tool: AgentTool = {
    name: 'list_files',
    description: 'List workspace files with ripgrep while preserving a bounded result.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        glob: { type: 'string' },
        max_results: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
    risk: 'read',
    permissionRequest: () => ({ toolName: 'list_files', risk: 'read' }),
    async execute(input, context) {
      const cwd = await guard.resolveExisting(optionalString(input.path, 'path') ?? '.')
      const maxResults = optionalInteger(input.max_results, 'max_results', 200, 1, 500)
      const args = ['--files', '--color', 'never']
      const glob = optionalString(input.glob, 'glob')
      if (glob) args.push('--glob', glob)
      const result = await runProcess(rgExecutable, args, {
        cwd,
        signal: context.signal,
        timeoutMs: 15_000,
        maxBytes: 256 * 1024,
        env: createSanitizedProcessEnvironment(process.env),
      })
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new ToolExecutionError(`rg failed with exit code ${result.exitCode}: ${result.stderr}`)
      }
      const files = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, maxResults)
      return files.length ? files.join('\n') : 'No files matched.'
    },
  }
  return Object.freeze(tool)
}

function createSearchTextTool(guard: WorkspaceGuard, rgExecutable: string): AgentTool {
  const tool: AgentTool = {
    name: 'search_text',
    description: 'Search text inside the workspace with ripgrep and line-numbered output.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        path: { type: 'string' },
        glob: { type: 'string' },
        max_results: { type: 'integer', minimum: 1, maximum: 300 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    risk: 'read',
    permissionRequest: () => ({ toolName: 'search_text', risk: 'read' }),
    async execute(input, context) {
      const query = requireString(input.query, 'query')
      const cwd = await guard.resolveExisting(optionalString(input.path, 'path') ?? '.')
      const maxResults = optionalInteger(input.max_results, 'max_results', 100, 1, 300)
      const args = ['--line-number', '--color', 'never', '--fixed-strings']
      const glob = optionalString(input.glob, 'glob')
      if (glob) args.push('--glob', glob)
      args.push('--', query, '.')
      const result = await runProcess(rgExecutable, args, {
        cwd,
        signal: context.signal,
        timeoutMs: 15_000,
        maxBytes: 512 * 1024,
        env: createSanitizedProcessEnvironment(process.env),
      })
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new ToolExecutionError(`rg failed with exit code ${result.exitCode}: ${result.stderr}`)
      }
      const matches = result.stdout.split(/\r?\n/).filter(Boolean).slice(0, maxResults)
      return matches.length ? matches.join('\n') : 'No matches.'
    },
  }
  return Object.freeze(tool)
}

function createRunCommandTool(guard: WorkspaceGuard): AgentTool {
  const tool: AgentTool = {
    name: 'run_command',
    description: 'Run an explicitly granted executable without a shell inside the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        executable: { type: 'string' },
        args: { type: 'array', items: { type: 'string' }, maxItems: 64 },
        cwd: { type: 'string' },
        timeout_ms: { type: 'integer', minimum: 100, maximum: 120000 },
      },
      required: ['executable'],
      additionalProperties: false,
    },
    risk: 'execute',
    permissionRequest(input) {
      return {
        toolName: 'run_command',
        risk: 'execute',
        command: requireExecutable(input.executable),
      }
    },
    async execute(input, context) {
      const executable = requireExecutable(input.executable)
      const args = optionalStringArray(input.args, 'args') ?? []
      const cwd = await guard.resolveExisting(optionalString(input.cwd, 'cwd') ?? '.')
      const metadata = await stat(cwd)
      if (!metadata.isDirectory()) throw new ToolInputError('cwd must identify a directory')
      const timeoutMs = optionalInteger(input.timeout_ms, 'timeout_ms', 30_000, 100, 120_000)
      const result = await runProcess(executable, args, {
        cwd,
        signal: context.signal,
        timeoutMs,
        maxBytes: 512 * 1024,
        env: createSanitizedProcessEnvironment(process.env),
      })
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      }
    },
  }
  return Object.freeze(tool)
}

type ProcessResult = Readonly<{
  exitCode: number
  stdout: string
  stderr: string
}>

async function runProcess(
  executable: string,
  args: readonly string[],
  options: {
    cwd: string
    signal: AbortSignal
    timeoutMs: number
    maxBytes: number
    env?: NodeJS.ProcessEnv
  },
): Promise<ProcessResult> {
  throwIfAborted(options.signal)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let settled = false
    let timedOut = false

    const append = (
      current: Buffer<ArrayBufferLike>,
      chunk: Buffer<ArrayBufferLike> | string,
    ): Buffer<ArrayBufferLike> => {
      if (current.length >= options.maxBytes) return current
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      return Buffer.concat([current, incoming.subarray(0, options.maxBytes - current.length)])
    }
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })

    const abort = (): void => { child.kill() }
    options.signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)
    timer.unref?.()

    const cleanup = (): void => {
      clearTimeout(timer)
      options.signal.removeEventListener('abort', abort)
    }
    child.once('error', error => {
      if (settled) return
      settled = true
      cleanup()
      reject(new ToolExecutionError(`failed to start ${executable}: ${error.message}`))
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      cleanup()
      if (options.signal.aborted) {
        reject(options.signal.reason ?? new Error('command cancelled'))
        return
      }
      if (timedOut) {
        reject(new ToolExecutionError(`command exceeded ${options.timeoutMs} ms`))
        return
      }
      resolve(Object.freeze({
        exitCode: code ?? -1,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
      }))
    })
  })
}

export function createSanitizedProcessEnvironment(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const name of [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'NODE_PATH',
  ]) {
    if (env[name] !== undefined) result[name] = env[name]
  }
  return result
}

function resolveTrustedPathExecutable(command: string, workspace: string): string {
  const pathValue = process.env.PATH ?? process.env.Path
  if (!pathValue) throw new ToolExecutionError(`PATH is required to locate ${command}`)
  const suffixes = process.platform === 'win32' ? ['.exe', ''] : ['']
  const realWorkspace = realpathSync(workspace)
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = path.resolve(directory, `${command}${suffix}`)
      if (!existsSync(candidate)) continue
      const realCandidate = realpathSync(candidate)
      if (!statSync(realCandidate).isFile()) continue
      if (isInside(realWorkspace, realCandidate)) continue
      return realCandidate
    }
  }
  throw new ToolExecutionError(
    `unable to locate a trusted ${command} executable outside the workspace`,
  )
}

async function abortableDecision(
  decision: PermissionDecision | Promise<PermissionDecision>,
  signal: AbortSignal,
): Promise<PermissionDecision> {
  throwIfAborted(signal)
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('permission decision cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([Promise.resolve(decision), aborted])
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}

function assertInside(root: string, candidate: string): void {
  if (!isInside(root, candidate)) {
    throw new ToolInputError('path escapes the configured workspace')
  }
}

function assertReadableFile(file: string): void {
  const name = path.basename(file).toLowerCase()
  if (name === '.env.example') return
  if (name === '.env' || name.startsWith('.env.')) {
    throw new ToolInputError('path is protected by the credential-file policy')
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function requireExecutable(value: unknown): string {
  const executable = requireString(value, 'executable')
  if (!/^[A-Za-z0-9_.-]+$/.test(executable)) {
    throw new ToolInputError('executable must be a bare command name')
  }
  return executable
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ToolInputError(`${name} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  return requireString(value, name)
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new ToolInputError(`${name} must be an array of strings`)
  }
  if (value.length > 64) throw new ToolInputError(`${name} has too many entries`)
  return [...value]
}

function optionalInteger(
  value: unknown,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ToolInputError(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function requireIdentifier(value: string, name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(value)) {
    throw new Error(`${name} must use the portable ASCII identifier form`)
  }
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('operation cancelled')
}
