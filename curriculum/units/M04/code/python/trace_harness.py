from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import asdict, dataclass
from typing import Literal, TypedDict


class HarnessMessage(TypedDict):
    kind: Literal["user", "assistant"]
    text: str


@dataclass(frozen=True)
class TraceEvent:
    seq: int
    type: str
    source: str = ""
    target: str = ""
    owner: str = ""
    field: str = ""
    size: int = 0
    detail: str = ""


class TraceLog:
    def __init__(self) -> None:
        self.events: list[TraceEvent] = []

    def record(self, event_type: str, **details: str | int) -> None:
        self.events.append(
            TraceEvent(seq=len(self.events) + 1, type=event_type, **details)
        )

    def observed_call(self, source: str, target: str) -> bool:
        return any(
            event.type == "call.entered"
            and event.source == source
            and event.target == target
            for event in self.events
        )

    def to_dicts(self) -> list[dict[str, object]]:
        return [asdict(event) for event in self.events]


@dataclass(frozen=True)
class ProcessInputResult:
    messages: list[HarnessMessage]
    should_query: bool


ProcessInput = Callable[
    [str, Sequence[HarnessMessage]], Awaitable[ProcessInputResult]
]
QueryStream = Callable[[Sequence[HarnessMessage]], AsyncIterator[HarnessMessage]]


class TraceableEngine:
    def __init__(
        self,
        initial_messages: list[HarnessMessage],
        process_input: ProcessInput,
        query_stream: QueryStream,
        trace: TraceLog | None = None,
    ) -> None:
        self._messages = initial_messages
        self._process_input = process_input
        self._query_stream = query_stream
        self.trace = trace or TraceLog()

    def get_messages(self) -> list[HarnessMessage]:
        return list(self._messages)

    async def submit_message(self, prompt: str) -> AsyncIterator[HarnessMessage]:
        self.trace.record(
            "call.entered",
            source="TraceableEngine.submitMessage",
            target="processInput",
        )
        processed = await self._process_input(prompt, list(self._messages))
        self._messages.extend(processed.messages)
        self.trace.record(
            "state.mutated",
            owner="TraceableEngine",
            field="messages",
            size=len(self._messages),
        )

        request_view = list(self._messages)
        self.trace.record(
            "view.snapshotted",
            owner="TraceableEngine",
            field="requestView",
            size=len(request_view),
        )
        if not processed.should_query:
            self.trace.record(
                "branch.skipped",
                field="queryStream",
                detail="processInput.shouldQuery=false",
            )
            return

        self.trace.record(
            "call.entered",
            source="TraceableEngine.submitMessage",
            target="queryStream",
        )
        try:
            async for message in self._query_stream(request_view):
                self.trace.record(
                    "event.yielded",
                    source="queryStream",
                    detail=message["kind"],
                )
                self._messages.append(message)
                self.trace.record(
                    "state.mutated",
                    owner="TraceableEngine",
                    field="messages",
                    size=len(self._messages),
                )
                yield message
        except Exception as error:
            self.trace.record(
                "call.failed", source="queryStream", detail=str(error)
            )
            raise


@dataclass
class ToolProbe:
    name: str
    run: Callable[[], None]


async def pass_tool_to_permission(
    tool: ToolProbe,
    can_use_tool: Callable[[ToolProbe], Awaitable[bool]],
    trace: TraceLog,
) -> bool:
    trace.record(
        "call.entered", source="permissionWrapper", target="canUseTool"
    )
    return await can_use_tool(tool)


async def collect(stream: AsyncIterator[HarnessMessage]) -> list[HarnessMessage]:
    return [message async for message in stream]
