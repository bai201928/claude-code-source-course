import {
  executeTool,
  parseMessage,
  summarizeMessage,
  transitionRunState,
  weatherTool,
  type RunState,
} from './contracts.ts'

const raw: unknown = {
  kind: 'user',
  id: 'm-1',
  timestamp: new Date().toISOString(),
  content: 'What is the weather?',
}

const message = parseMessage(raw)
let state: RunState = { kind: 'idle' }
state = transitionRunState(state, { kind: 'running', turn: 1 })
const weather = await executeTool(weatherTool, { city: 'Shanghai' })
state = transitionRunState(state, {
  kind: 'completed',
  finalMessageId: message.id,
})

console.log(
  JSON.stringify(
    {
      message: summarizeMessage(message),
      toolOutput: weather,
      finalState: state,
    },
    null,
    2,
  ),
)
