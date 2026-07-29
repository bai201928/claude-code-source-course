import {
  DurableConversation,
  ScriptedModel,
  TraceRecorder,
  assistantText,
  assistantTool,
  query,
  userText,
  type ToolPort,
} from "./query-loop.ts";

const initial = [userText("What is 20 + 22?")];
const durable = new DurableConversation(initial);
const trace = new TraceRecorder();
const add: ToolPort = {
  name: "add",
  async execute(input) {
    return Number(input.left) + Number(input.right);
  },
};
const model = new ScriptedModel([
  () => assistantTool("call-1", "add", { left: 20, right: 22 }),
  () => assistantText("The answer is 42."),
]);
const iterator = query({
  initialMessages: initial,
  model,
  tools: [add],
  signal: new AbortController().signal,
  trace,
});

const events = [];
let terminal;
while (true) {
  const step = await iterator.next();
  if (step.done) {
    terminal = step.value;
    break;
  }
  durable.consume(step.value);
  events.push(step.value.type);
}

console.log(JSON.stringify({
  events,
  terminal,
  modelRequestSizes: model.requests.map((request) => request.length),
  durableMessageCount: durable.snapshot().length,
  trace: trace.entries.map((entry) => entry.type),
}, null, 2));
