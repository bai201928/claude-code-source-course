import { spawn } from 'node:child_process'
import type { Readable } from 'node:stream'

export type ProcessEvent =
  | { type: 'process.started'; pid: number }
  | { type: 'process.stdout'; text: string }
  | { type: 'process.stderr'; text: string }
  | { type: 'cancel.requested'; reason: string }
  | { type: 'process.exited'; code: number | null; signal: string | null }
  | { type: 'cleanup.finished' }

export type ProcessResult = {
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out'
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  events: ProcessEvent[]
}

export function createCancellationScope(
  parent: AbortSignal | undefined,
  timeoutMs?: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const forward = (): void => controller.abort(parent?.reason ?? 'parent')
  let timer: ReturnType<typeof setTimeout> | undefined

  if (parent?.aborted) {
    forward()
  } else {
    parent?.addEventListener('abort', forward, { once: true })
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => controller.abort('timeout'), timeoutMs)
      timer.unref?.()
    }
  }

  return {
    signal: controller.signal,
    cleanup(): void {
      if (timer !== undefined) clearTimeout(timer)
      parent?.removeEventListener('abort', forward)
    },
  }
}

export class ResourceScope {
  private readonly disposers: Array<() => void | Promise<void>> = []
  private disposed = false

  register(disposer: () => void | Promise<void>): () => void {
    if (this.disposed) throw new Error('scope already disposed')
    this.disposers.push(disposer)
    return () => {
      const index = this.disposers.indexOf(disposer)
      if (index >= 0) this.disposers.splice(index, 1)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const disposer of this.disposers.reverse()) await disposer()
    this.disposers.length = 0
  }
}

export async function observeEventLoop(): Promise<string[]> {
  const trace = ['sync']
  queueMicrotask(() => trace.push('microtask'))
  setTimeout(() => trace.push('timer'), 0)
  await new Promise(resolve => setTimeout(resolve, 10))
  return trace
}

async function collect(
  stream: Readable,
  type: 'process.stdout' | 'process.stderr',
  events: ProcessEvent[],
  onStdout?: (text: string) => void,
): Promise<string> {
  let result = ''
  stream.setEncoding('utf8')
  for await (const chunk of stream) {
    const text = String(chunk)
    result += text
    events.push({ type, text })
    if (type === 'process.stdout') onStdout?.(text)
  }
  return result
}

const CHILD_PROGRAM = String.raw`
const count = Number(process.argv[1]);
const interval = Number(process.argv[2]);
let current = 0;
const timer = setInterval(() => {
  current += 1;
  process.stdout.write('tick:' + current + '\n');
  if (current === 2) process.stderr.write('diagnostic:2\n');
  if (current >= count) {
    clearInterval(timer);
    process.exit(0);
  }
}, interval);
`

export async function runChildProcess(options: {
  count?: number
  intervalMs?: number
  signal?: AbortSignal
  timeoutMs?: number
  onStdout?: (text: string) => void
} = {}): Promise<ProcessResult> {
  const events: ProcessEvent[] = []
  const scope = new ResourceScope()
  const cancellation = createCancellationScope(options.signal, options.timeoutMs)
  scope.register(cancellation.cleanup)

  const child = spawn(
    process.execPath,
    ['-e', CHILD_PROGRAM, String(options.count ?? 3), String(options.intervalMs ?? 20)],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  events.push({ type: 'process.started', pid: child.pid ?? -1 })

  const stdoutPromise = collect(child.stdout, 'process.stdout', events, options.onStdout)
  const stderrPromise = collect(child.stderr, 'process.stderr', events)
  let cancelReason: string | undefined

  const requestTermination = (): void => {
    if (cancelReason !== undefined) return
    cancelReason = String(cancellation.signal.reason ?? 'cancelled')
    events.push({ type: 'cancel.requested', reason: cancelReason })
    child.kill()
  }

  cancellation.signal.addEventListener('abort', requestTermination, { once: true })
  scope.register(() => cancellation.signal.removeEventListener('abort', requestTermination))
  if (cancellation.signal.aborted) requestTermination()

  const exit = await new Promise<{ code: number | null; signal: string | null }>(
    (resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    },
  )
  events.push({ type: 'process.exited', code: exit.code, signal: exit.signal })
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  await scope.dispose()
  events.push({ type: 'cleanup.finished' })

  const status =
    cancelReason === 'timeout'
      ? 'timed_out'
      : cancelReason !== undefined
        ? 'cancelled'
        : exit.code === 0
          ? 'completed'
          : 'failed'

  return {
    status,
    stdout,
    stderr,
    exitCode: exit.code,
    signal: exit.signal,
    events,
  }
}
