export type TextBlock = {
  type: "text";
  text: string;
};

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ToolResultBlock = {
  type: "tool_result";
  toolUseId: string;
  content: unknown;
  isError: boolean;
};

export type UserMessage = {
  role: "user";
  blocks: Array<TextBlock | ToolResultBlock>;
};

export type AssistantMessage = {
  role: "assistant";
  blocks: Array<TextBlock | ToolUseBlock>;
};

export type Message = UserMessage | AssistantMessage;

export type QueryEvent =
  | {
      type: "request";
      turn: number;
      messages: readonly Message[];
    }
  | {
      type: "assistant";
      message: AssistantMessage;
    }
  | {
      type: "tool_result";
      message: UserMessage;
    }
  | {
      type: "interruption";
      phase: "before_request" | "model" | "tool";
    }
  | {
      type: "model_error";
      message: string;
    };

export type LoopTerminal = {
  reason: "completed" | "aborted" | "model_error" | "max_turns";
  turns: number;
};

export type TraceEntry = {
  type: string;
  detail?: Record<string, unknown>;
};

export class TraceRecorder {
  readonly entries: TraceEntry[] = [];

  record(type: string, detail?: Record<string, unknown>): void {
    this.entries.push(detail ? { type, detail } : { type });
  }
}

export interface ModelPort {
  stream(
    messages: readonly Message[],
    signal: AbortSignal,
  ): AsyncGenerator<AssistantMessage, void>;
}

export interface ToolPort {
  readonly name: string;
  execute(
    input: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export type QueryParams = {
  initialMessages: readonly Message[];
  model: ModelPort;
  tools: readonly ToolPort[];
  signal: AbortSignal;
  trace: TraceRecorder;
  maxTurns?: number;
};

type LoopState = {
  messages: Message[];
  turns: number;
};

export async function* queryLoop(
  params: QueryParams,
): AsyncGenerator<QueryEvent, LoopTerminal> {
  const tools = new Map(params.tools.map((tool) => [tool.name, tool]));
  const maxTurns = params.maxTurns ?? 8;
  let state: LoopState = {
    messages: structuredClone([...params.initialMessages]),
    turns: 0,
  };

  try {
    while (true) {
      if (params.signal.aborted) {
        yield { type: "interruption", phase: "before_request" };
        return { reason: "aborted", turns: state.turns };
      }
      if (state.turns >= maxTurns) {
        return { reason: "max_turns", turns: state.turns };
      }

      const turn = state.turns + 1;
      const requestMessages = structuredClone(state.messages);
      params.trace.record("producer.request.before_yield", { turn });
      yield { type: "request", turn, messages: requestMessages };
      params.trace.record("producer.request.after_yield", { turn });

      const assistantMessages: AssistantMessage[] = [];
      try {
        for await (const assistant of params.model.stream(
          requestMessages,
          params.signal,
        )) {
          params.trace.record("producer.assistant.before_yield", { turn });
          yield { type: "assistant", message: structuredClone(assistant) };
          params.trace.record("producer.assistant.after_yield", { turn });
          assistantMessages.push(structuredClone(assistant));
        }
      } catch (error) {
        if (params.signal.aborted || error instanceof CancelledError) {
          yield { type: "interruption", phase: "model" };
          return { reason: "aborted", turns: state.turns };
        }
        const message = error instanceof Error ? error.message : String(error);
        yield { type: "model_error", message };
        return { reason: "model_error", turns: state.turns };
      }

      if (params.signal.aborted) {
        yield { type: "interruption", phase: "model" };
        return { reason: "aborted", turns: state.turns };
      }

      const toolUses = assistantMessages.flatMap((message) =>
        message.blocks.filter(
          (block): block is ToolUseBlock => block.type === "tool_use",
        ),
      );
      if (toolUses.length === 0) {
        return { reason: "completed", turns: turn };
      }

      const toolResults: UserMessage[] = [];
      for (const call of toolUses) {
        if (params.signal.aborted) {
          yield { type: "interruption", phase: "tool" };
          return { reason: "aborted", turns: state.turns };
        }

        const tool = tools.get(call.name);
        let content: unknown;
        let isError = false;
        try {
          if (!tool) throw new Error(`unknown tool: ${call.name}`);
          content = await tool.execute(call.input, params.signal);
          if (params.signal.aborted) {
            throw new CancelledError("cancelled during tool execution");
          }
        } catch (error) {
          isError = true;
          content = error instanceof Error ? error.message : String(error);
        }

        const result: UserMessage = {
          role: "user",
          blocks: [
            {
              type: "tool_result",
              toolUseId: call.id,
              content,
              isError,
            },
          ],
        };
        params.trace.record("producer.tool_result.before_yield", {
          toolUseId: call.id,
        });
        yield { type: "tool_result", message: structuredClone(result) };
        params.trace.record("producer.tool_result.after_yield", {
          toolUseId: call.id,
        });
        toolResults.push(result);

        if (params.signal.aborted) {
          yield { type: "interruption", phase: "tool" };
          return { reason: "aborted", turns: turn };
        }
      }

      state = {
        messages: [
          ...state.messages,
          ...assistantMessages,
          ...toolResults,
        ],
        turns: turn,
      };
      params.trace.record("producer.state.continue", {
        turn,
        messageCount: state.messages.length,
      });
    }
  } finally {
    params.trace.record("producer.loop.finally");
  }
}

export async function* query(
  params: QueryParams,
): AsyncGenerator<QueryEvent, LoopTerminal> {
  try {
    const terminal = yield* queryLoop(params);
    params.trace.record("wrapper.normal_completion", {
      reason: terminal.reason,
    });
    return terminal;
  } finally {
    params.trace.record("wrapper.finally");
  }
}

export async function drainWithTerminal(
  iterator: AsyncGenerator<QueryEvent, LoopTerminal>,
): Promise<{ events: QueryEvent[]; terminal: LoopTerminal }> {
  const events: QueryEvent[] = [];
  while (true) {
    const step = await iterator.next();
    if (step.done) return { events, terminal: step.value };
    events.push(step.value);
  }
}

export type ModelScript = (
  messages: readonly Message[],
  signal: AbortSignal,
  callIndex: number,
) => AssistantMessage | Promise<AssistantMessage>;

export class ScriptedModel implements ModelPort {
  readonly requests: Message[][] = [];
  private readonly scripts: readonly ModelScript[];

  constructor(scripts: readonly ModelScript[]) {
    this.scripts = scripts;
  }

  async *stream(
    messages: readonly Message[],
    signal: AbortSignal,
  ): AsyncGenerator<AssistantMessage, void> {
    if (signal.aborted) throw new CancelledError("model cancelled");
    const request = structuredClone([...messages]);
    this.requests.push(request);
    const script = this.scripts[this.requests.length - 1];
    if (!script) throw new Error("unexpected model request");
    yield structuredClone(
      await script(request, signal, this.requests.length - 1),
    );
  }
}

export class DurableConversation {
  private readonly messages: Message[];

  constructor(initialMessages: readonly Message[]) {
    this.messages = structuredClone([...initialMessages]);
  }

  consume(event: QueryEvent): void {
    if (event.type === "assistant" || event.type === "tool_result") {
      this.messages.push(structuredClone(event.message));
    }
  }

  snapshot(): readonly Message[] {
    return structuredClone(this.messages);
  }
}

export class CancelledError extends Error {}

export function userText(text: string): UserMessage {
  return { role: "user", blocks: [{ type: "text", text }] };
}

export function assistantText(text: string): AssistantMessage {
  return { role: "assistant", blocks: [{ type: "text", text }] };
}

export function assistantTool(
  id: string,
  name: string,
  input: Record<string, unknown>,
): AssistantMessage {
  return {
    role: "assistant",
    blocks: [{ type: "tool_use", id, name, input }],
  };
}

export function findToolResult(
  messages: readonly Message[],
  toolUseId: string,
): ToolResultBlock | undefined {
  for (const message of messages) {
    if (message.role !== "user") continue;
    for (const block of message.blocks) {
      if (block.type === "tool_result" && block.toolUseId === toolUseId) {
        return block;
      }
    }
  }
  return undefined;
}

export function waitUntilAborted(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(new CancelledError("model cancelled"));
  }
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(new CancelledError("model cancelled")),
      { once: true },
    );
  });
}
