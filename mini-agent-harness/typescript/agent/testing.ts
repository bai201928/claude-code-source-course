import type { ModelAdapter, ModelRequest, ModelResponse } from './model.ts'

export type ModelScript = (
  request: ModelRequest,
  callIndex: number,
  signal: AbortSignal,
) => ModelResponse | Promise<ModelResponse>

export class ScriptedModelAdapter implements ModelAdapter {
  readonly provider = 'scripted'
  readonly model: string
  readonly requests: ModelRequest[] = []
  readonly #scripts: readonly ModelScript[]

  constructor(scripts: readonly ModelScript[], model = 'scripted-model') {
    this.#scripts = [...scripts]
    this.model = model
  }

  async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (signal.aborted) throw signal.reason ?? new Error('model call cancelled')
    const copy = structuredClone(request)
    this.requests.push(copy)
    const script = this.#scripts[this.requests.length - 1]
    if (!script) throw new Error('unexpected model request')
    return structuredClone(await script(copy, this.requests.length - 1, signal))
  }
}

