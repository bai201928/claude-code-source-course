import {
  HeadlessSurface,
  InteractiveSurface,
  type DomainEvent,
  type RuntimeCommand,
  type RuntimeCore,
} from './runtimeSurface.ts'

class DemoCore implements RuntimeCore {
  async *run(command: RuntimeCommand): AsyncGenerator<DomainEvent> {
    yield { type: 'progress', text: `routing ${command.text}` }
    yield { type: 'result', text: `answer for ${command.text}` }
  }
}

const interactive = new InteractiveSurface(new DemoCore())
const headless = new HeadlessSurface(new DemoCore())

console.log('interactive output')
console.log((await interactive.submit('hello')).output)

console.log('stream-json output')
console.log(
  (await headless.submit('hello', {
    inputFormat: 'text',
    outputFormat: 'stream-json',
  })).output,
)

console.log('headless trace')
console.log(headless.trace.events)

