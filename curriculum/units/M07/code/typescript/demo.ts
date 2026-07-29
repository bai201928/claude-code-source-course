import {
  createRequestContext,
  createRuntimeContext,
  createSessionStateStore,
  readFreshSession,
} from './runtime-context.ts'

const trace: string[] = []
const runtime = createRuntimeContext({
  runtimeId: 'demo-runtime',
  configurationRevision: 3,
  modelAdapter: 'fake-model',
})
const session = createSessionStateStore(
  { permissionMode: 'default', tools: ['Read'] },
  change => trace.push(`observer:${change.newState.revision}`),
)
session.subscribe(() => trace.push(`subscriber:${session.getState().revision}`))

const request = createRequestContext(runtime, session, 'request-1')
session.publish({ permissionMode: 'plan', tools: ['Read', 'Glob'] })
const fresh = readFreshSession(request, session)

console.log(
  JSON.stringify(
    {
      requestSnapshot: request,
      freshRead: fresh,
      notificationTrace: trace,
    },
    null,
    2,
  ),
)

