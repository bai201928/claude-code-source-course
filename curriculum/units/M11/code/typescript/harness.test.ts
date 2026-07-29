import assert from "node:assert/strict";
import {
  AgentLoop,
  CancelledError,
  HeadlessInputAdapter,
  IdSource,
  ReplInputAdapter,
  RequestProjector,
  ScriptedModel,
  SessionStore,
  TraceSink,
  assistantWithText,
  assistantWithTool,
  findToolResult,
  type Tool,
} from "./harness.ts";

async function testTwoRoundToolLoop(): Promise<void> {
  const ids = new IdSource();
  const session = new SessionStore();
  const trace = new TraceSink();
  const model = new ScriptedModel([
    () =>
      assistantWithTool("assistant-1", {
        type: "tool_use",
        id: "call-1",
        name: "add",
        input: { left: 20, right: 22 },
      }),
    (request) => {
      const result = findToolResult(request.messages, "call-1");
      assert.equal(result?.content, 42);
      assert.equal(result?.isError, false);
      return assistantWithText("assistant-2", "The answer is 42.");
    },
  ]);
  const addTool: Tool = {
    name: "add",
    async execute(input) {
      return Number(input.left) + Number(input.right);
    },
  };
  const loop = new AgentLoop(
    session,
    new RequestProjector(ids),
    model,
    [addTool],
    ids,
    trace,
  );

  const result = await loop.submit(
    "Calculate 20 + 22",
    new ReplInputAdapter(),
    new AbortController().signal,
  );

  assert.equal(result.status, "completed");
  assert.equal(model.requests.length, 2);
  assert.equal(model.requests[0]?.messages.length, 1);
  assert.equal(model.requests[1]?.messages.length, 3);
  assert.deepEqual(
    trace.events.map((event) => event.type),
    [
      "input.accepted",
      "request.projected",
      "model.request",
      "assistant.received",
      "tool.started",
      "tool.finished",
      "tool_result.appended",
      "request.projected",
      "model.request",
      "assistant.received",
      "loop.completed",
    ],
  );
}

async function testToolErrorBecomesProtocolMessage(): Promise<void> {
  const ids = new IdSource();
  const session = new SessionStore();
  const trace = new TraceSink();
  const model = new ScriptedModel([
    () =>
      assistantWithTool("assistant-1", {
        type: "tool_use",
        id: "call-fail",
        name: "fail",
        input: {},
      }),
    (request) => {
      const result = findToolResult(request.messages, "call-fail");
      assert.equal(result?.isError, true);
      assert.equal(result?.content, "simulated failure");
      return assistantWithText("assistant-2", "The tool failed safely.");
    },
  ]);
  const failingTool: Tool = {
    name: "fail",
    async execute() {
      throw new Error("simulated failure");
    },
  };
  const loop = new AgentLoop(
    session,
    new RequestProjector(ids),
    model,
    [failingTool],
    ids,
    trace,
  );

  const result = await loop.submit(
    "Run the failing tool",
    new HeadlessInputAdapter(),
    new AbortController().signal,
  );

  assert.equal(result.status, "completed");
  assert.equal(model.requests.length, 2);
}

async function testCancellationStopsBeforeSecondRequest(): Promise<void> {
  const ids = new IdSource();
  const session = new SessionStore();
  const trace = new TraceSink();
  const controller = new AbortController();
  const model = new ScriptedModel([
    () => ({
      kind: "assistant",
      id: "assistant-1",
      blocks: [
        {
          type: "tool_use",
          id: "call-cancel",
          name: "cancel",
          input: {},
        },
        {
          type: "tool_use",
          id: "call-not-started",
          name: "not-started",
          input: {},
        },
      ],
    }),
  ]);
  const cancellingTool: Tool = {
    name: "cancel",
    async execute() {
      controller.abort("test cancellation");
      throw new CancelledError("cancelled by test");
    },
  };
  const loop = new AgentLoop(
    session,
    new RequestProjector(ids),
    model,
    [cancellingTool],
    ids,
    trace,
  );

  const result = await loop.submit(
    "Cancel during the tool",
    new ReplInputAdapter(),
    controller.signal,
  );

  assert.equal(result.status, "cancelled");
  assert.equal(model.requests.length, 1);
  assert.equal(
    findToolResult(session.snapshot(), "call-cancel")?.isError,
    true,
  );
  assert.equal(
    findToolResult(session.snapshot(), "call-not-started")?.isError,
    true,
  );
  assert.equal(
    trace.events.some(
      (event) => event.type === "tool.started" &&
        event.detail?.toolUseId === "call-not-started",
    ),
    false,
  );
  assert.equal(trace.events.at(-1)?.type, "loop.cancelled");
}

function testProjectionDoesNotShareArrayStructure(): void {
  const ids = new IdSource();
  const session = new SessionStore();
  session.append(new ReplInputAdapter().accept("first", ids));
  const request = new RequestProjector(ids).project(session.snapshot());
  session.append(new ReplInputAdapter().accept("later", ids));
  assert.equal(request.messages.length, 1);
  assert.equal(session.snapshot().length, 2);
}

await testTwoRoundToolLoop();
await testToolErrorBecomesProtocolMessage();
await testCancellationStopsBeforeSecondRequest();
testProjectionDoesNotShareArrayStructure();

console.log("TypeScript M11 contract tests: 4 passed");
