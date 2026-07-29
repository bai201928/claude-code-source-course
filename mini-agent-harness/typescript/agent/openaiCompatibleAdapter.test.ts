import assert from 'node:assert/strict'
import test from 'node:test'
import {
  OpenAICompatibleAdapter,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from './openaiCompatibleAdapter.ts'
import { ModelProtocolError, ModelTransportError, type ModelRequest } from './model.ts'

test('projects messages and tools into Chat Completions without exposing credentials elsewhere', async () => {
  const transport = new ScriptedTransport({
    status: 200,
    body: {
      id: 'response-1',
      choices: [{
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'hello' },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    },
  })
  const adapter = new OpenAICompatibleAdapter({
    apiKey: 'dummy-test-key',
    baseUrl: 'https://api.example.test/v1',
    model: 'test-model',
    transport,
  })

  const response = await adapter.complete(requestFixture(), new AbortController().signal)

  assert.equal(response.text, 'hello')
  assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 2, totalTokens: 12 })
  assert.equal(transport.requests[0]?.url, 'https://api.example.test/v1/chat/completions')
  assert.equal(transport.requests[0]?.headers.authorization, 'Bearer dummy-test-key')
  const body = JSON.parse(transport.requests[0]!.body)
  assert.equal(body.tools[0].function.name, 'read_file')
  assert.equal(body.messages[0].role, 'user')
})

test('parses function arguments into provider-neutral tool calls', async () => {
  const adapter = adapterWith({
    status: 200,
    body: {
      id: 'response-tool',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"README.md"}' },
          }],
        },
      }],
    },
  })

  const response = await adapter.complete(requestFixture(), new AbortController().signal)

  assert.deepEqual(response.toolCalls, [
    { id: 'call-1', name: 'read_file', input: { path: 'README.md' } },
  ])
})

test('uses typed, credential-free errors for HTTP failures', async () => {
  const adapter = adapterWith({ status: 401, body: { error: { message: 'do not relay me' } } })

  await assert.rejects(
    adapter.complete(requestFixture(), new AbortController().signal),
    error => {
      assert.equal(error instanceof ModelTransportError, true)
      assert.equal((error as ModelTransportError).category, 'authentication')
      assert.doesNotMatch((error as Error).message, /dummy-test-key|do not relay me/)
      return true
    },
  )
})

test('classifies an HTML non-2xx response before JSON protocol parsing', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(
    '<html><body>unauthorized</body></html>',
    { status: 401, headers: { 'content-type': 'text/html' } },
  )
  try {
    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'dummy-test-key',
      baseUrl: 'https://api.example.test/v1',
      model: 'test-model',
    })

    await assert.rejects(
      adapter.complete(requestFixture(), new AbortController().signal),
      error => {
        assert.equal(error instanceof ModelTransportError, true)
        assert.equal((error as ModelTransportError).category, 'authentication')
        assert.equal((error as ModelTransportError).status, 401)
        assert.equal(error instanceof ModelProtocolError, false)
        return true
      },
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('requires an assistant response role and function tool-call type', async () => {
  const wrongRole = adapterWith({
    status: 200,
    body: {
      id: 'response-role',
      choices: [{
        finish_reason: 'stop',
        message: { role: 'user', content: 'not an assistant' },
      }],
    },
  })
  await assert.rejects(
    wrongRole.complete(requestFixture(), new AbortController().signal),
    error => error instanceof ModelProtocolError && /role must be assistant/.test(error.message),
  )

  const wrongToolType = adapterWith({
    status: 200,
    body: {
      id: 'response-type',
      choices: [{ finish_reason: 'tool_calls', message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'custom',
          function: { name: 'read_file', arguments: '{}' },
        }],
      } }],
    },
  })
  await assert.rejects(
    wrongToolType.complete(requestFixture(), new AbortController().signal),
    error => error instanceof ModelProtocolError && /type must be function/.test(error.message),
  )
})

test('rejects malformed tool arguments and unsafe base URLs', async () => {
  const adapter = adapterWith({
    status: 200,
    body: {
      id: 'response-tool',
      choices: [{ finish_reason: 'tool_calls', message: {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'read_file', arguments: '{' },
        }],
      } }],
    },
  })
  await assert.rejects(
    adapter.complete(requestFixture(), new AbortController().signal),
    ModelProtocolError,
  )
  assert.throws(
    () => new OpenAICompatibleAdapter({
      apiKey: 'dummy',
      baseUrl: 'http://remote.example/v1',
      model: 'test-model',
    }),
    /HTTPS/,
  )
})

test('rejects partial output terminated by a non-success finish reason', async () => {
  const adapter = adapterWith({
    status: 200,
    body: {
      id: 'response-truncated',
      choices: [{
        finish_reason: 'length',
        message: { role: 'assistant', content: 'partial answer' },
      }],
    },
  })

  await assert.rejects(
    adapter.complete(requestFixture(), new AbortController().signal),
    error => error instanceof ModelProtocolError && /finish_reason: length/.test(error.message),
  )
})

class ScriptedTransport implements HttpTransport {
  readonly requests: HttpRequest[] = []
  readonly #response: HttpResponse

  constructor(response: HttpResponse) {
    this.#response = response
  }

  async send(request: HttpRequest, signal: AbortSignal): Promise<HttpResponse> {
    assert.equal(signal.aborted, false)
    this.requests.push(request)
    return structuredClone(this.#response)
  }
}

function adapterWith(response: HttpResponse): OpenAICompatibleAdapter {
  return new OpenAICompatibleAdapter({
    apiKey: 'dummy-test-key',
    baseUrl: 'https://api.example.test/v1',
    model: 'test-model',
    transport: new ScriptedTransport(response),
  })
}

function requestFixture(): ModelRequest {
  return {
    requestId: 'request-1',
    model: 'test-model',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    }],
  }
}
