import {
  AgentLoop,
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

const ids = new IdSource();
const session = new SessionStore();
const trace = new TraceSink();
const model = new ScriptedModel([
  () =>
    assistantWithTool("assistant-1", {
      type: "tool_use",
      id: "call-1",
      name: "lookup_weather",
      input: { city: "Shanghai" },
    }),
  (request) => {
    const result = findToolResult(request.messages, "call-1");
    return assistantWithText(
      "assistant-2",
      `The observed temperature is ${String(result?.content)} C.`,
    );
  },
]);
const weatherTool: Tool = {
  name: "lookup_weather",
  async execute() {
    return 31;
  },
};
const loop = new AgentLoop(
  session,
  new RequestProjector(ids),
  model,
  [weatherTool],
  ids,
  trace,
);

const result = await loop.submit(
  "What is the weather in Shanghai?",
  new ReplInputAdapter(),
  new AbortController().signal,
);

console.log(JSON.stringify({ result, events: trace.events }, null, 2));
