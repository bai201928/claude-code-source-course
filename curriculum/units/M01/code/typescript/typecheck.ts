import { executeTypedTool, weatherTool, type HarnessMessage } from './contracts.ts'

const valid: HarnessMessage = {
  kind: 'user',
  id: 'm-1',
  timestamp: '2026-07-28T00:00:00.000Z',
  content: 'hello',
}

void valid

// @ts-expect-error A user variant requires content, not blocks.
const wrongFields: HarnessMessage = {
  kind: 'user',
  id: 'm-2',
  timestamp: '2026-07-28T00:00:00.000Z',
}

void wrongFields

// @ts-expect-error The generic input type requires a string city.
void executeTypedTool(weatherTool, { city: 42 })
