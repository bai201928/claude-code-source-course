from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Protocol


Message = dict[str, Any]
ModelRequest = dict[str, Any]


class CancelledError(Exception):
    pass


class CancellationToken:
    def __init__(self) -> None:
        self.cancelled = False
        self.reason: str | None = None

    def cancel(self, reason: str) -> None:
        self.cancelled = True
        self.reason = reason

    def raise_if_cancelled(self) -> None:
        if self.cancelled:
            raise CancelledError(self.reason or "cancelled")


class IdSource:
    def __init__(self) -> None:
        self._next = 1

    def next(self, prefix: str) -> str:
        value = f"{prefix}-{self._next}"
        self._next += 1
        return value


class TraceSink:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def record(self, event_type: str, **detail: Any) -> None:
        event: dict[str, Any] = {"type": event_type}
        if detail:
            event["detail"] = detail
        self.events.append(event)


class SessionStore:
    def __init__(self) -> None:
        self._messages: list[Message] = []

    def append(self, message: Message) -> None:
        self._messages.append(copy.deepcopy(message))

    def snapshot(self) -> list[Message]:
        return copy.deepcopy(self._messages)


class InputAdapter(Protocol):
    source: str

    def accept(self, raw: str, ids: IdSource) -> Message:
        ...


class ReplInputAdapter:
    source = "repl"

    def accept(self, raw: str, ids: IdSource) -> Message:
        return {
            "kind": "user",
            "id": ids.next("message"),
            "source": self.source,
            "blocks": [{"type": "text", "text": raw}],
        }


class HeadlessInputAdapter:
    source = "headless"

    def accept(self, raw: str, ids: IdSource) -> Message:
        return {
            "kind": "user",
            "id": ids.next("message"),
            "source": self.source,
            "blocks": [{"type": "text", "text": raw}],
        }


class RequestProjector:
    def __init__(self, ids: IdSource) -> None:
        self._ids = ids

    def project(self, messages: list[Message]) -> ModelRequest:
        return {
            "id": self._ids.next("request"),
            "messages": copy.deepcopy(messages),
        }


class ModelAdapter(Protocol):
    async def complete(
        self, request: ModelRequest, token: CancellationToken
    ) -> Message:
        ...


class Tool(Protocol):
    name: str

    async def execute(
        self, input_data: dict[str, Any], token: CancellationToken
    ) -> Any:
        ...


@dataclass(frozen=True)
class RunResult:
    status: str
    final_message: Message | None = None


class AgentLoop:
    def __init__(
        self,
        session: SessionStore,
        projector: RequestProjector,
        model: ModelAdapter,
        tools: list[Tool],
        ids: IdSource,
        trace: TraceSink,
        max_turns: int = 8,
    ) -> None:
        self._session = session
        self._projector = projector
        self._model = model
        self._tools = {tool.name: tool for tool in tools}
        self._ids = ids
        self._trace = trace
        self._max_turns = max_turns

    async def submit(
        self,
        raw_input: str,
        adapter: InputAdapter,
        token: CancellationToken,
    ) -> RunResult:
        input_message = adapter.accept(raw_input, self._ids)
        self._session.append(input_message)
        self._trace.record(
            "input.accepted",
            source=adapter.source,
            message_id=input_message["id"],
        )
        return await self._run(token)

    async def _run(self, token: CancellationToken) -> RunResult:
        for turn in range(1, self._max_turns + 1):
            if token.cancelled:
                self._trace.record("loop.cancelled", phase="before_request")
                return RunResult("cancelled")

            request = self._projector.project(self._session.snapshot())
            self._trace.record(
                "request.projected",
                request_id=request["id"],
                message_count=len(request["messages"]),
            )
            self._trace.record("model.request", request_id=request["id"], turn=turn)

            try:
                assistant = await self._model.complete(request, token)
            except CancelledError:
                self._trace.record("loop.cancelled", phase="model")
                return RunResult("cancelled")

            self._session.append(assistant)
            self._trace.record("assistant.received", message_id=assistant["id"])
            tool_uses = [
                block
                for block in assistant["blocks"]
                if block["type"] == "tool_use"
            ]

            if not tool_uses:
                self._trace.record("loop.completed", turn=turn)
                return RunResult("completed", assistant)

            for tool_index, call in enumerate(tool_uses):
                if token.cancelled:
                    self._append_cancelled_tool_results(
                        tool_uses[tool_index:], "cancelled before execution"
                    )
                    self._trace.record("loop.cancelled", phase="before_tool")
                    return RunResult("cancelled")

                self._trace.record(
                    "tool.started",
                    tool_use_id=call["id"],
                    tool_name=call["name"],
                )
                tool = self._tools.get(call["name"])

                try:
                    if tool is None:
                        raise RuntimeError(f"unknown tool: {call['name']}")
                    output = await tool.execute(call["input"], token)
                    token.raise_if_cancelled()
                    self._trace.record(
                        "tool.finished", tool_use_id=call["id"], status="success"
                    )
                    self._append_tool_result(call, output, is_error=False)
                except CancelledError:
                    self._trace.record(
                        "tool.finished", tool_use_id=call["id"], status="cancelled"
                    )
                    self._append_tool_result(
                        call, "cancelled during tool execution", is_error=True
                    )
                    self._append_cancelled_tool_results(
                        tool_uses[tool_index + 1 :], "cancelled before execution"
                    )
                    self._trace.record("loop.cancelled", phase="tool")
                    return RunResult("cancelled")
                except Exception as error:
                    self._trace.record(
                        "tool.finished", tool_use_id=call["id"], status="error"
                    )
                    self._append_tool_result(call, str(error), is_error=True)

        self._trace.record("loop.max_turns", max_turns=self._max_turns)
        return RunResult("max_turns")

    def _append_cancelled_tool_results(
        self, calls: list[dict[str, Any]], content: str
    ) -> None:
        for call in calls:
            self._append_tool_result(call, content, is_error=True)

    def _append_tool_result(
        self, call: dict[str, Any], content: Any, is_error: bool
    ) -> None:
        result = {
            "kind": "user",
            "id": self._ids.next("message"),
            "source": "tool",
            "blocks": [
                {
                    "type": "tool_result",
                    "toolUseId": call["id"],
                    "content": content,
                    "isError": is_error,
                }
            ],
        }
        self._session.append(result)
        self._trace.record(
            "tool_result.appended", tool_use_id=call["id"], is_error=is_error
        )


Script = Callable[[ModelRequest, int], Message]


class ScriptedModel:
    def __init__(self, scripts: list[Script]) -> None:
        self._scripts = scripts
        self.requests: list[ModelRequest] = []

    async def complete(
        self, request: ModelRequest, token: CancellationToken
    ) -> Message:
        token.raise_if_cancelled()
        request_copy = copy.deepcopy(request)
        self.requests.append(request_copy)
        index = len(self.requests) - 1
        if index >= len(self._scripts):
            raise RuntimeError("unexpected model request")
        return copy.deepcopy(self._scripts[index](request_copy, index))


def find_tool_result(messages: list[Message], tool_use_id: str) -> dict[str, Any] | None:
    for message in messages:
        if message["kind"] != "user":
            continue
        for block in message["blocks"]:
            if block["type"] == "tool_result" and block["toolUseId"] == tool_use_id:
                return block
    return None


def assistant_with_text(message_id: str, text: str) -> Message:
    return {
        "kind": "assistant",
        "id": message_id,
        "blocks": [{"type": "text", "text": text}],
    }


def assistant_with_tool(
    message_id: str, tool_use_id: str, name: str, input_data: dict[str, Any]
) -> Message:
    return {
        "kind": "assistant",
        "id": message_id,
        "blocks": [
            {
                "type": "tool_use",
                "id": tool_use_id,
                "name": name,
                "input": input_data,
            }
        ],
    }
