import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  PermissionDeniedError,
  PolicyPermissionGate,
  type PermissionGate,
} from './permissions.ts'
import {
  AgentToolRegistry,
  ToolInputError,
  createBuiltinTools,
  createSanitizedProcessEnvironment,
  type AgentTool,
} from './tools.ts'

test('abort after permission resolution prevents tool execution', async () => {
  const controller = new AbortController()
  let executions = 0
  let resolveDecision!: (decision: { allowed: true; reason: string }) => void
  const gate: PermissionGate = {
    decide() {
      return new Promise(resolve => { resolveDecision = resolve })
    },
  }
  const candidate: AgentTool = Object.freeze({
    name: 'permission_race',
    description: 'Prove cancellation wins before execution.',
    inputSchema: Object.freeze({ type: 'object' }),
    risk: 'read',
    permissionRequest: () => ({ toolName: 'permission_race', risk: 'read' as const }),
    async execute() {
      executions += 1
      return 'must not run'
    },
  })
  const registry = new AgentToolRegistry()
  registry.register(candidate)
  const pending = registry.dispatch(
    candidate.name,
    {},
    { workspace: process.cwd(), signal: controller.signal },
    gate,
    new Set([candidate.name]),
  )

  resolveDecision({ allowed: true, reason: 'allowed before cancellation' })
  controller.abort(new Error('cancelled after permission resolution'))

  await assert.rejects(pending, /cancelled after permission resolution/)
  assert.equal(executions, 0)
})

test('built-in tools enforce workspace, permission, argv and secret boundaries', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'mini-agent-harness-'))
  try {
    await writeFile(path.join(workspace, 'sample.txt'), 'alpha\nbeta\nalpha\n', 'utf8')
    await writeFile(
      path.join(workspace, '.env.local'),
      'MINI_AGENT_API_KEY=must-not-enter-the-conversation\n',
      'utf8',
    )
    await writeFile(path.join(workspace, '.env.example'), 'MINI_AGENT_API_KEY=\n', 'utf8')
    const registry = new AgentToolRegistry()
    for (const tool of createBuiltinTools(workspace)) registry.register(tool)
    const visible = new Set(registry.names())
    const signal = new AbortController().signal
    const readGate = new PolicyPermissionGate()

    const read = await registry.dispatch(
      'read_file',
      { path: 'sample.txt', start_line: 2, max_lines: 1 },
      { workspace, signal },
      readGate,
      visible,
    )
    assert.equal(read.output, '2: beta')

    await assert.rejects(
      registry.dispatch(
        'read_file',
        { path: '.env.local' },
        { workspace, signal },
        readGate,
        visible,
      ),
      error => {
        assert.equal(error instanceof ToolInputError, true)
        assert.match((error as Error).message, /credential-file policy/)
        assert.doesNotMatch((error as Error).message, /must-not-enter/)
        return true
      },
    )
    const example = await registry.dispatch(
      'read_file',
      { path: '.env.example' },
      { workspace, signal },
      readGate,
      visible,
    )
    assert.match(String(example.output), /MINI_AGENT_API_KEY=/)

    const search = await registry.dispatch(
      'search_text',
      { query: 'alpha', max_results: 1 },
      { workspace, signal },
      readGate,
      visible,
    )
    assert.match(String(search.output), /sample\.txt:1:alpha/)

    await assert.rejects(
      registry.dispatch(
        'read_file',
        { path: '..' },
        { workspace, signal },
        readGate,
        visible,
      ),
      ToolInputError,
    )

    await assert.rejects(
      registry.dispatch(
        'run_command',
        { executable: 'node', args: ['--version'] },
        { workspace, signal },
        readGate,
        visible,
      ),
      PermissionDeniedError,
    )

    const previous = process.env.MINI_AGENT_API_KEY
    process.env.MINI_AGENT_API_KEY = 'dummy-secret-for-test'
    try {
      const command = await registry.dispatch(
        'run_command',
        {
          executable: 'node',
          args: ['-e', "process.stdout.write(process.env.MINI_AGENT_API_KEY ?? 'missing')"],
        },
        { workspace, signal },
        new PolicyPermissionGate(['node']),
        visible,
      )
      assert.deepEqual(command.output, { exitCode: 0, stdout: 'missing', stderr: '' })
    } finally {
      if (previous === undefined) delete process.env.MINI_AGENT_API_KEY
      else process.env.MINI_AGENT_API_KEY = previous
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('list and search skip a workspace-local fake rg executable', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'mini-agent-rg-boundary-'))
  const previousPath = process.env.PATH
  try {
    await writeFile(path.join(workspace, 'sample.txt'), 'alpha\n', 'utf8')
    const fakeName = process.platform === 'win32' ? 'rg.exe' : 'rg'
    await writeFile(
      path.join(workspace, fakeName),
      'workspace-local executable must never run',
      'utf8',
    )
    const inheritedPath = previousPath ?? process.env.Path
    assert.ok(inheritedPath)
    process.env.PATH = `${workspace}${path.delimiter}${inheritedPath}`
    const registry = new AgentToolRegistry()
    for (const tool of createBuiltinTools(workspace)) registry.register(tool)
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    const visible = new Set(registry.names())
    const context = { workspace, signal: new AbortController().signal }
    const gate = new PolicyPermissionGate()

    const listed = await registry.dispatch('list_files', {}, context, gate, visible)
    const searched = await registry.dispatch(
      'search_text',
      { query: 'alpha' },
      context,
      gate,
      visible,
    )

    assert.match(String(listed.output), /sample\.txt/)
    assert.match(String(searched.output), /sample\.txt:1:alpha/)
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    await rm(workspace, { recursive: true, force: true })
  }
})

test('list and search actually launch rg with the sanitized environment', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'mini-agent-rg-env-'))
  const environmentNames = [
    'RIPGREP_CONFIG_PATH',
    'MINI_AGENT_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'DEEPSEEK_API_KEY',
  ] as const
  const previous = Object.fromEntries(
    environmentNames.map(name => [name, process.env[name]]),
  )
  try {
    await writeFile(path.join(workspace, 'sample.txt'), 'alpha\n', 'utf8')
    const configPath = path.join(workspace, 'host-ripgrep-config')
    await writeFile(configPath, '--glob=!**\n', 'utf8')
    process.env.RIPGREP_CONFIG_PATH = configPath
    process.env.MINI_AGENT_API_KEY = 'test-secret'
    process.env.OPENAI_API_KEY = 'test-secret'
    process.env.ANTHROPIC_API_KEY = 'test-secret'
    process.env.DEEPSEEK_API_KEY = 'test-secret'

    const registry = new AgentToolRegistry()
    for (const tool of createBuiltinTools(workspace)) registry.register(tool)
    const visible = new Set(registry.names())
    const context = { workspace, signal: new AbortController().signal }
    const gate = new PolicyPermissionGate()
    const listed = await registry.dispatch('list_files', {}, context, gate, visible)
    const searched = await registry.dispatch(
      'search_text',
      { query: 'alpha' },
      context,
      gate,
      visible,
    )

    assert.match(String(listed.output), /sample\.txt/)
    assert.match(String(searched.output), /sample\.txt:1:alpha/)
  } finally {
    for (const name of environmentNames) {
      const value = previous[name]
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await rm(workspace, { recursive: true, force: true })
  }
})

test('list and search child environments exclude provider credentials', () => {
  const childEnvironment = createSanitizedProcessEnvironment({
    PATH: 'C:\\trusted-bin',
    SystemRoot: 'C:\\Windows',
    MINI_AGENT_API_KEY: 'secret',
    OPENAI_API_KEY: 'secret',
    ANTHROPIC_API_KEY: 'secret',
    DEEPSEEK_API_KEY: 'secret',
    AZURE_OPENAI_API_KEY: 'secret',
    GEMINI_API_KEY: 'secret',
    CUSTOM_PROVIDER_TOKEN: 'secret',
  })

  assert.equal(childEnvironment.PATH, 'C:\\trusted-bin')
  assert.equal(childEnvironment.SystemRoot, 'C:\\Windows')
  for (const name of [
    'MINI_AGENT_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'DEEPSEEK_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'CUSTOM_PROVIDER_TOKEN',
  ]) {
    assert.equal(childEnvironment[name], undefined)
  }
})
