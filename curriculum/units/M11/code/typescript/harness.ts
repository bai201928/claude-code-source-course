export type InputSource = "repl" | "headless" | "tool";

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
  kind: "user";
  id: string;
  source: InputSource;
  blocks: Array<TextBlock | ToolResultBlock>;
};

export type AssistantMessage = {
  kind: "assistant";
  id: string;
  blocks: Array<TextBlock | ToolUseBlock>;
};

export type ConversationMessage = UserMessage | AssistantMessage;

export type ModelRequest = {
  id: string;
  messages: readonly ConversationMessage[];
};

export type TraceEvent = {
  type: string;
  detail?: Record<string, unknown>;
};

export class TraceSink {
  readonly events: TraceEvent[] = [];

  record(type: string, detail?: Record<string, unknown>): void {
    this.events.push(detail ? { type, detail } : { type });
  }
}

export class IdSource {
  private nextValue = 1;

  next(prefix: string): string {
    return `${prefix}-${this.nextValue++}`;
  }
}

export class SessionStore {
  private readonly messages: ConversationMessage[] = [];

  append(message: ConversationMessage): void {
    this.messages.push(structuredClone(message));
  }

  snapshot(): readonly ConversationMessage[] {
    return structuredClone(this.messages);
  }
}

export interface InputAdapter {
  readonly source: "repl" | "headless";
  accept(raw: string, ids: IdSource): UserMessage;
}

export class ReplInputAdapter implements InputAdapter {
  readonly source = "repl" as const;

  accept(raw: string, ids: IdSource): UserMessage {
    return {
      kind: "user",
      id: ids.next("message"),
      source: this.source,
      blocks: [{ type: "text", text: raw }],
    };
  }
}

export class HeadlessInputAdapter implements InputAdapter {
  readonly source = "headless" as const;

  accept(raw: string, ids: IdSource): UserMessage {
    return {
      kind: "user",
      id: ids.next("message"),
      source: this.source,
      blocks: [{ type: "text", text: raw }],
    };
  }
}

export class RequestProjector {
  private readonly ids: IdSource;

  constructor(ids: IdSource) {
    this.ids = ids;
  }

  project(messages: readonly ConversationMessage[]): ModelRequest {
    return {
      id: this.ids.next("request"),
      messages: structuredClone(messages),
    };
  }
}

export interface ModelAdapter {
  complete(request: ModelRequest, signal: AbortSignal): Promise<AssistantMessage>;
}

export interface Tool {
  readonly name: string;
  execute(input: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}

export type RunResult = {
  status: "completed" | "cancelled" | "max_turns";
  finalMessage?: AssistantMessage;
};

export class AgentLoop {
  private readonly session: SessionStore;
  private readonly projector: RequestProjector;
  private readonly model: ModelAdapter;
  private readonly ids: IdSource;
  private readonly trace: TraceSink;
  private readonly maxTurns: number;

  constructor(
    session: SessionStore,
    projector: RequestProjector,
    model: ModelAdapter,
    tools: readonly Tool[],
    ids: IdSource,
    trace: TraceSink,
    maxTurns = 8,
  ) {
    this.session = session;
    this.projector = projector;
    this.model = model;
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
    this.ids = ids;
    this.trace = trace;
    this.maxTurns = maxTurns;
  }

  private readonly tools: Map<string, Tool>;

  async submit(
    rawInput: string,
    adapter: InputAdapter,
    signal: AbortSignal,
  ): Promise<RunResult> {
    const inputMessage = adapter.accept(rawInput, this.ids);
    this.session.append(inputMessage);
    this.trace.record("input.accepted", {
      source: adapter.source,
      messageId: inputMessage.id,
    });

    return this.run(signal);
  }

  private async run(signal: AbortSignal): Promise<RunResult> {
    for (let turn = 1; turn <= this.maxTurns; turn++) {
      if (signal.aborted) {
        this.trace.record("loop.cancelled", { phase: "before_request" });
        return { status: "cancelled" };
      }

      const request = this.projector.project(this.session.snapshot());
      this.trace.record("request.projected", {
        requestId: request.id,
        messageCount: request.messages.length,
      });
      this.trace.record("model.request", { requestId: request.id, turn });

      let assistant: AssistantMessage;
      try {
        assistant = await this.model.complete(request, signal);
      } catch (error) {
        if (signal.aborted || error instanceof CancelledError) {
          this.trace.record("loop.cancelled", { phase: "model" });
          return { status: "cancelled" };
        }
        throw error;
      }

      this.session.append(assistant);
      this.trace.record("assistant.received", { messageId: assistant.id });

      const toolUses = assistant.blocks.filter(
        (block): block is ToolUseBlock => block.type === "tool_use",
      );
      if (toolUses.length === 0) {
        this.trace.record("loop.completed", { turn });
        return { status: "completed", finalMessage: assistant };
      }

      for (let toolIndex = 0; toolIndex < toolUses.length; toolIndex++) {
        const call = toolUses[toolIndex]!;
        if (signal.aborted) {
          this.appendCancelledToolResults(
            toolUses.slice(toolIndex),
            "cancelled before execution",
          );
          this.trace.record("loop.cancelled", { phase: "before_tool" });
          return { status: "cancelled" };
        }

        this.trace.record("tool.started", {
          toolUseId: call.id,
          toolName: call.name,
        });
        const tool = this.tools.get(call.name);

        try {
          if (!tool) {
            throw new Error(`unknown tool: ${call.name}`);
          }
          const output = await tool.execute(call.input, signal);
          if (signal.aborted) {
            throw new CancelledError("cancelled during tool execution");
          }
          this.trace.record("tool.finished", {
            toolUseId: call.id,
            status: "success",
          });
          this.appendToolResult(call, output, false);
        } catch (error) {
          const cancelled = signal.aborted || error instanceof CancelledError;
          const content = cancelled
            ? "cancelled during tool execution"
            : error instanceof Error
              ? error.message
              : String(error);
          this.trace.record("tool.finished", {
            toolUseId: call.id,
            status: cancelled ? "cancelled" : "error",
          });
          this.appendToolResult(call, content, true);
          if (cancelled) {
            this.appendCancelledToolResults(
              toolUses.slice(toolIndex + 1),
              "cancelled before execution",
            );
            this.trace.record("loop.cancelled", { phase: "tool" });
            return { status: "cancelled" };
          }
        }
      }
    }

    this.trace.record("loop.max_turns", { maxTurns: this.maxTurns });
    return { status: "max_turns" };
  }

  private appendCancelledToolResults(
    calls: readonly ToolUseBlock[],
    content: string,
  ): void {
    for (const call of calls) {
      this.appendToolResult(call, content, true);
    }
  }

  private appendToolResult(
    call: ToolUseBlock,
    content: unknown,
    isError: boolean,
  ): void {
    const result: UserMessage = {
      kind: "user",
      id: this.ids.next("message"),
      source: "tool",
      blocks: [
        {
          type: "tool_result",
          toolUseId: call.id,
          content,
          isError,
        },
      ],
    };
    this.session.append(result);
    this.trace.record("tool_result.appended", {
      toolUseId: call.id,
      isError,
    });
  }
}

export class CancelledError extends Error {}

export class ScriptedModel implements ModelAdapter {
  readonly requests: ModelRequest[] = [];
  private readonly scripts: Array<
    (request: ModelRequest, callIndex: number) => AssistantMessage
  >;

  constructor(
    scripts: Array<
      (request: ModelRequest, callIndex: number) => AssistantMessage
    >,
  ) {
    this.scripts = scripts;
  }

  async complete(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<AssistantMessage> {
    if (signal.aborted) throw new CancelledError("model cancelled");
    const copy = structuredClone(request);
    this.requests.push(copy);
    const script = this.scripts[this.requests.length - 1];
    if (!script) throw new Error("unexpected model request");
    return structuredClone(script(copy, this.requests.length - 1));
  }
}

export function findToolResult(
  messages: readonly ConversationMessage[],
  toolUseId: string,
): ToolResultBlock | undefined {
  for (const message of messages) {
    if (message.kind !== "user") continue;
    for (const block of message.blocks) {
      if (block.type === "tool_result" && block.toolUseId === toolUseId) {
        return block;
      }
    }
  }
  return undefined;
}

export function assistantWithText(id: string, text: string): AssistantMessage {
  return { kind: "assistant", id, blocks: [{ type: "text", text }] };
}

export function assistantWithTool(
  id: string,
  call: ToolUseBlock,
): AssistantMessage {
  return { kind: "assistant", id, blocks: [call] };
}
