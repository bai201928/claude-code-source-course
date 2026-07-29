export type Listener = () => void
export type Observer<T> = (change: { newState: T; oldState: T }) => void

export type SynchronousStore<T> = {
  getState(): T
  setState(updater: (previous: T) => T): void
  subscribe(listener: Listener): () => void
}

export function createSynchronousStore<T>(
  initialState: T,
  observer?: Observer<T>,
): SynchronousStore<T> {
  let state = initialState
  const listeners = new Set<Listener>()

  return {
    getState: () => state,
    setState(updater) {
      const previous = state
      const next = updater(previous)
      if (Object.is(next, previous)) return

      state = next
      observer?.({ newState: next, oldState: previous })
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type RuntimeContext = Readonly<{
  runtimeId: string
  configurationRevision: number
  modelAdapter: string
  startedAt: number
}>

export type RuntimeContextInput = {
  runtimeId: string
  configurationRevision: number
  modelAdapter: string
  startedAt?: number
}

export function createRuntimeContext(input: RuntimeContextInput): RuntimeContext {
  requireNonEmpty(input.runtimeId, 'runtimeId')
  requireNonEmpty(input.modelAdapter, 'modelAdapter')
  requireRevision(input.configurationRevision, 'configurationRevision')
  const startedAt = input.startedAt ?? Date.now()
  if (!Number.isFinite(startedAt)) throw new Error('startedAt must be finite')

  return Object.freeze({
    runtimeId: input.runtimeId,
    configurationRevision: input.configurationRevision,
    modelAdapter: input.modelAdapter,
    startedAt,
  })
}

export type SessionValues = Readonly<Record<string, unknown>>

export type SessionState = Readonly<{
  revision: number
  values: SessionValues
}>

export type SessionStateStore = {
  getState(): SessionState
  publish(values: Record<string, unknown>): SessionState
  subscribe(listener: Listener): () => void
}

export function createSessionStateStore(
  initialValues: Record<string, unknown>,
  observer?: Observer<SessionState>,
): SessionStateStore {
  const store = createSynchronousStore(
    createSessionState(1, initialValues),
    observer,
  )

  return {
    getState: store.getState,
    subscribe: store.subscribe,
    publish(values) {
      store.setState(previous =>
        createSessionState(previous.revision + 1, values),
      )
      return store.getState()
    },
  }
}

export type RequestContext = Readonly<{
  requestId: string
  runtimeId: string
  configurationRevision: number
  sessionRevision: number
  sessionValues: SessionValues
}>

export function createRequestContext(
  runtime: RuntimeContext | undefined,
  sessionStore: SessionStateStore | undefined,
  requestId: string,
): RequestContext {
  if (!runtime) throw new Error('runtime context is required before a request')
  if (!sessionStore) throw new Error('session state store is required before a request')
  requireNonEmpty(requestId, 'requestId')

  const session = sessionStore.getState()
  return Object.freeze({
    requestId,
    runtimeId: runtime.runtimeId,
    configurationRevision: runtime.configurationRevision,
    sessionRevision: session.revision,
    sessionValues: session.values,
  })
}

export type FreshSessionRead = Readonly<{
  requestId: string
  observedSessionRevision: number
  sessionValues: SessionValues
}>

export function readFreshSession(
  request: RequestContext,
  sessionStore: SessionStateStore,
): FreshSessionRead {
  const current = sessionStore.getState()
  return Object.freeze({
    requestId: request.requestId,
    observedSessionRevision: current.revision,
    sessionValues: current.values,
  })
}

function createSessionState(
  revision: number,
  values: Record<string, unknown>,
): SessionState {
  requireRevision(revision, 'session revision')
  return deepFreeze({
    revision,
    values: cloneValue(values),
  })
}

function requireNonEmpty(value: string, name: string): void {
  if (value.trim() === '') throw new Error(`${name} must not be empty`)
}

function requireRevision(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => cloneValue(item)) as T
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)]),
    ) as T
  }
  return value
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

