import { delegatedRun } from './eventStream.ts'

const trace: string[] = []
const iterator = delegatedRun('demo-run', trace)
const events: unknown[] = []
let summary: unknown

while (true) {
  const step = await iterator.next()
  if (step.done) {
    summary = step.value
    break
  }
  events.push(step.value)
}

console.log(JSON.stringify({ events, summary, trace }, null, 2))
