import { Scheduler, type Tool } from './tool-scheduler.ts'

const tool = (name: string, safe: boolean): Tool => ({
  name,
  parse: input => input,
  isConcurrencySafe: () => safe,
  permission: () => 'allow',
  async run(_input, report) {
    report('running')
    await new Promise(resolve => setTimeout(resolve, safe ? 10 : 20))
    return { output: `${name}:ok`, update: { last: name } }
  },
})

async function main(): Promise<void> {
  const scheduler = new Scheduler([tool('readA', true), tool('readB', true), tool('writeC', false)])
  const calls = ['readA', 'readB', 'writeC'].map(name => ({ id: `call-${name}`, name, input: {} }))
  const result = await scheduler.execute(calls, new AbortController().signal, console.log)
  console.log(result)
}

void main()
