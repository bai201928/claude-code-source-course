import {
  DurableConversation,
  ScriptedModel,
  TraceRecorder,
  assistantText,
  assistantTool,
  drainWithTerminal,
  findToolResult,
  query,
  userText,
  waitUntilAborted,
  type QueryEvent,
  type ToolPort,
} from "./query-loop.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function testTwoRoundToolLoopAndTerminal(): Promise<void> {
  const trace = new TraceRecorder();
  const model = new ScriptedModel([
    () => assistantTool("call-1", "add", { left: 20, right: 22 }),
    (messages) => {
      const result = findToolResult(messages, "call-1");
      equal(result?.content, 42, "second request should contain tool result");
      return assistantText("42");
    },
  ]);
  const add: ToolPort = {
    name: "add",
    async execute(input) {
      return Number(input.left) + Number(input.right);
    },
  };
  const run = await drainWithTerminal(
    query({
      initialMessages: [userText("20 + 22")],
      model,
      tools: [add],
      signal: new AbortController().signal,
      trace,
    }),
  );

  equal(run.terminal.reason, "completed", "terminal reason");
  equal(run.terminal.turns, 2, "turn count");
  equal(model.requests.length, 2, "model request count");
  equal(model.requests[0]?.length, 1, "first request snapshot size");
  equal(model.requests[1]?.length, 3, "second request local state size");
  equal(
    run.events.map((event) => event.type).join(","),
    "request,assistant,tool_result,request,assistant",
    "event order",
  );
}

async function testYieldOrderingAndSeparateOwners(): Promise<void> {
  const trace = new TraceRecorder();
  const initial = [userText("hello")];
  const durable = new DurableConversation(initial);
  const iterator = query({
    initialMessages: initial,
    model: new ScriptedModel([() => assistantText("hi")]),
    tools: [],
    signal: new AbortController().signal,
    trace,
  });

  await iterator.next();
  const assistantStep = await iterator.next();
  assert(!assistantStep.done && assistantStep.value.type === "assistant", "assistant event expected");
  trace.record("consumer.assistant.persist");
  durable.consume(assistantStep.value);
  const terminalStep = await iterator.next();

  assert(terminalStep.done, "generator should finish");
  equal(durable.snapshot().length, 2, "durable owner should persist event");
  equal(
    trace.entries.map((entry) => entry.type).join(","),
    [
      "producer.request.before_yield",
      "producer.request.after_yield",
      "producer.assistant.before_yield",
      "consumer.assistant.persist",
      "producer.assistant.after_yield",
      "producer.loop.finally",
      "wrapper.normal_completion",
      "wrapper.finally",
    ].join(","),
    "consumer must run between yield and producer bookkeeping",
  );
}

async function testForAwaitDoesNotExposeTerminal(): Promise<void> {
  const trace = new TraceRecorder();
  const iterator = query({
    initialMessages: [userText("hello")],
    model: new ScriptedModel([() => assistantText("hi")]),
    tools: [],
    signal: new AbortController().signal,
    trace,
  });
  const events: QueryEvent[] = [];
  for await (const event of iterator) events.push(event);
  const afterExhaustion = await iterator.next();

  equal(events.length, 2, "for-await event count");
  assert(afterExhaustion.done, "iterator should stay done");
  equal(afterExhaustion.value, undefined, "terminal value is no longer observable");

  const manual = await drainWithTerminal(
    query({
      initialMessages: [userText("hello")],
      model: new ScriptedModel([() => assistantText("hi")]),
      tools: [],
      signal: new AbortController().signal,
      trace: new TraceRecorder(),
    }),
  );
  equal(manual.terminal.reason, "completed", "manual next should capture terminal");
}

async function testConsumerCloseSkipsPostYieldBookkeeping(): Promise<void> {
  const trace = new TraceRecorder();
  const iterator = query({
    initialMessages: [userText("stop after assistant")],
    model: new ScriptedModel([() => assistantText("visible")]),
    tools: [],
    signal: new AbortController().signal,
    trace,
  });

  await iterator.next();
  const assistantStep = await iterator.next();
  assert(!assistantStep.done && assistantStep.value.type === "assistant", "assistant event expected");
  await iterator.return(undefined as never);

  const names = trace.entries.map((entry) => entry.type);
  assert(names.includes("producer.assistant.before_yield"), "pre-yield trace missing");
  assert(!names.includes("producer.assistant.after_yield"), "post-yield bookkeeping must be skipped");
  assert(names.includes("producer.loop.finally"), "producer finally must run");
  assert(names.includes("wrapper.finally"), "wrapper finally must run");
  assert(!names.includes("wrapper.normal_completion"), "normal wrapper tail must be skipped");
}

async function testCancellationDuringModelWait(): Promise<void> {
  const trace = new TraceRecorder();
  const controller = new AbortController();
  const model = new ScriptedModel([
    (_messages, signal) => waitUntilAborted(signal),
  ]);
  const iterator = query({
    initialMessages: [userText("wait")],
    model,
    tools: [],
    signal: controller.signal,
    trace,
  });

  const request = await iterator.next();
  assert(!request.done && request.value.type === "request", "request event expected");
  const waiting = iterator.next();
  await Promise.resolve();
  controller.abort("test cancellation");
  const interruption = await waiting;
  assert(!interruption.done && interruption.value.type === "interruption", "interruption expected");
  equal(interruption.value.phase, "model", "cancellation phase");
  const terminal = await iterator.next();
  assert(terminal.done, "aborted generator should terminate");
  equal(terminal.value.reason, "aborted", "aborted terminal");
  equal(model.requests.length, 1, "cancellation must not start another request");
}

async function testModelErrorBecomesEventAndTerminal(): Promise<void> {
  const run = await drainWithTerminal(
    query({
      initialMessages: [userText("fail")],
      model: new ScriptedModel([() => {
        throw new Error("simulated model failure");
      }]),
      tools: [],
      signal: new AbortController().signal,
      trace: new TraceRecorder(),
    }),
  );

  equal(run.events.at(-1)?.type, "model_error", "model error event");
  equal(run.terminal.reason, "model_error", "model error terminal");
}

await testTwoRoundToolLoopAndTerminal();
await testYieldOrderingAndSeparateOwners();
await testForAwaitDoesNotExposeTerminal();
await testConsumerCloseSkipsPostYieldBookkeeping();
await testCancellationDuringModelWait();
await testModelErrorBecomesEventAndTerminal();

console.log("TypeScript M12 contract tests: 6 passed");
