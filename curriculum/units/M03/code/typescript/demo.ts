import { observeEventLoop, runChildProcess } from './runtimeHarness.ts'

const eventLoop = await observeEventLoop()
const controller = new AbortController()
const processResult = await runChildProcess({
  count: 100,
  intervalMs: 30,
  signal: controller.signal,
  onStdout: text => {
    if (text.includes('tick:2')) controller.abort('demo_cancel')
  },
})

console.log(JSON.stringify({ eventLoop, processResult }, null, 2))
