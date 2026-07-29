from __future__ import annotations

import asyncio
import copy
import inspect
from dataclasses import dataclass
from typing import Any, AsyncIterator, Awaitable, Callable, Protocol


Message = dict[str, Any]
QueryEvent = dict[str, Any]
ModelScript = Callable[
    [list[Message], "CancellationToken", int],
    Message | Awaitable[Message],
]


@dataclass(frozen=True)
class LoopTerminal:
    reason: str
    turns: int


class CancelledError(Exception):
    pass


class CancellationToken:
    def __init__(self) -> None:
        self._event = asyncio.Event()
        self.reason: str | None = None

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def cancel(self, reason: str) -> None:
        self.reason = reason
        self._event.set()

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            raise CancelledError(self.reason or "cancelled")

    async def wait(self) -> None:
        await self._event.wait()
        raise CancelledError(self.reason or "cancelled")


class TraceRecorder:
    def __init__(self) -> None:
        self.entries: list[dict[str, Any]] = []

    def record(self, event_type: str, **detail: Any) -> None:
        entry: dict[str, Any] = {"type": event_type}
        if detail:
            entry["detail"] = detail
        self.entries.append(entry)


class ModelPort(Protocol):
    def stream(
        self,
        messages: list[Message],
        token: CancellationToken,
    ) -> AsyncIterator[Message]:
        ...


class ToolPort(Protocol):
    name: str

    async def execute(
        self,
        input_data: dict[str, Any],
        token: CancellationToken,
    ) -> Any:
        ...


class ScriptedModel:
    def __init__(self, scripts: list[ModelScript]) -> None:
        self._scripts = scripts
        self.requests: list[list[Message]] = []

    async def stream(
        self,
        messages: list[Message],
        token: CancellationToken,
    ) -> AsyncIterator[Message]:
        token.raise_if_cancelled()
        request = copy.deepcopy(messages)
        self.requests.append(request)
        index = len(self.requests) - 1
        if index >= len(self._scripts):
            raise RuntimeError("unexpected model request")
        produced = self._scripts[index](request, token, index)
        message = await produced if inspect.isawaitable(produced) else produced
        yield copy.deepcopy(message)


class DurableConversation:
    def __init__(self, initial_messages: list[Message]) -> None:
        self._messages = copy.deepcopy(initial_messages)

    def consume(self, event: QueryEvent) -> None:
        if event["type"] in {"assistant", "tool_result"}:
            self._messages.append(copy.deepcopy(event["message"]))

    def snapshot(self) -> list[Message]:
        return copy.deepcopy(self._messages)


class QueryRun:
    """Owns Python's terminal side channel because async generators cannot return values."""

    def __init__(
        self,
        initial_messages: list[Message],
        model: ModelPort,
        tools: list[ToolPort],
        token: CancellationToken,
        trace: TraceRecorder,
        max_turns: int = 8,
    ) -> None:
        self._initial_messages = copy.deepcopy(initial_messages)
        self._model = model
        self._tools = {tool.name: tool for tool in tools}
        self._token = token
        self._trace = trace
        self._max_turns = max_turns
        self.terminal: LoopTerminal | None = None

    async def events(self) -> AsyncIterator[QueryEvent]:
        state_messages = copy.deepcopy(self._initial_messages)
        turns = 0
        try:
            while True:
                if self._token.cancelled:
                    yield {"type": "interruption", "phase": "before_request"}
                    self.terminal = LoopTerminal("aborted", turns)
                    return
                if turns >= self._max_turns:
                    self.terminal = LoopTerminal("max_turns", turns)
                    return

                turn = turns + 1
                request_messages = copy.deepcopy(state_messages)
                self._trace.record("producer.request.before_yield", turn=turn)
                yield {
                    "type": "request",
                    "turn": turn,
                    "messages": request_messages,
                }
                self._trace.record("producer.request.after_yield", turn=turn)

                assistant_messages: list[Message] = []
                try:
                    async for assistant in self._model.stream(
                        request_messages,
                        self._token,
                    ):
                        self._trace.record(
                            "producer.assistant.before_yield",
                            turn=turn,
                        )
                        yield {
                            "type": "assistant",
                            "message": copy.deepcopy(assistant),
                        }
                        self._trace.record(
                            "producer.assistant.after_yield",
                            turn=turn,
                        )
                        assistant_messages.append(copy.deepcopy(assistant))
                except CancelledError:
                    yield {"type": "interruption", "phase": "model"}
                    self.terminal = LoopTerminal("aborted", turns)
                    return
                except Exception as error:
                    yield {"type": "model_error", "message": str(error)}
                    self.terminal = LoopTerminal("model_error", turns)
                    return

                if self._token.cancelled:
                    yield {"type": "interruption", "phase": "model"}
                    self.terminal = LoopTerminal("aborted", turns)
                    return

                tool_uses = [
                    block
                    for message in assistant_messages
                    for block in message["blocks"]
                    if block["type"] == "tool_use"
                ]
                if not tool_uses:
                    self.terminal = LoopTerminal("completed", turn)
                    return

                tool_results: list[Message] = []
                for call in tool_uses:
                    if self._token.cancelled:
                        yield {"type": "interruption", "phase": "tool"}
                        self.terminal = LoopTerminal("aborted", turns)
                        return

                    tool = self._tools.get(call["name"])
                    is_error = False
                    try:
                        if tool is None:
                            raise RuntimeError(f"unknown tool: {call['name']}")
                        content = await tool.execute(call["input"], self._token)
                        self._token.raise_if_cancelled()
                    except Exception as error:
                        is_error = True
                        content = str(error)

                    result: Message = {
                        "role": "user",
                        "blocks": [
                            {
                                "type": "tool_result",
                                "toolUseId": call["id"],
                                "content": content,
                                "isError": is_error,
                            }
                        ],
                    }
                    self._trace.record(
                        "producer.tool_result.before_yield",
                        tool_use_id=call["id"],
                    )
                    yield {
                        "type": "tool_result",
                        "message": copy.deepcopy(result),
                    }
                    self._trace.record(
                        "producer.tool_result.after_yield",
                        tool_use_id=call["id"],
                    )
                    tool_results.append(result)

                    if self._token.cancelled:
                        yield {"type": "interruption", "phase": "tool"}
                        self.terminal = LoopTerminal("aborted", turn)
                        return

                state_messages = [
                    *state_messages,
                    *assistant_messages,
                    *tool_results,
                ]
                turns = turn
                self._trace.record(
                    "producer.state.continue",
                    turn=turn,
                    message_count=len(state_messages),
                )
        finally:
            self._trace.record("producer.loop.finally")


async def query_events(run: QueryRun, trace: TraceRecorder) -> AsyncIterator[QueryEvent]:
    inner = run.events()
    try:
        async for event in inner:
            yield event
        trace.record(
            "wrapper.normal_completion",
            reason=run.terminal.reason if run.terminal else None,
        )
    finally:
        await inner.aclose()
        trace.record("wrapper.finally")


def user_text(text: str) -> Message:
    return {"role": "user", "blocks": [{"type": "text", "text": text}]}


def assistant_text(text: str) -> Message:
    return {"role": "assistant", "blocks": [{"type": "text", "text": text}]}


def assistant_tool(
    tool_use_id: str,
    name: str,
    input_data: dict[str, Any],
) -> Message:
    return {
        "role": "assistant",
        "blocks": [
            {
                "type": "tool_use",
                "id": tool_use_id,
                "name": name,
                "input": input_data,
            }
        ],
    }


def find_tool_result(
    messages: list[Message],
    tool_use_id: str,
) -> dict[str, Any] | None:
    for message in messages:
        if message["role"] != "user":
            continue
        for block in message["blocks"]:
            if (
                block["type"] == "tool_result"
                and block["toolUseId"] == tool_use_id
            ):
                return block
    return None
