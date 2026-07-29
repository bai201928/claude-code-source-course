from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import asdict, dataclass
from typing import Literal, TypedDict


class HarnessMessage(TypedDict):
    kind: Literal["user", "assistant", "progress"]
    text: str


@dataclass(frozen=True)
class RunState:
    status: Literal["idle", "running", "completed", "failed", "cancelled"]
    error: str = ""
    reason: str = ""


@dataclass(frozen=True)
class H0Event:
    seq: int
    type: str
    details: dict[str, object]


class TraceLog:
    def __init__(self) -> None:
        self.events: list[H0Event] = []

    def record(self, event_type: str, **details: object) -> None:
        self.events.append(H0Event(len(self.events) + 1, event_type, details))

    def to_dicts(self) -> list[dict[str, object]]:
        return [asdict(event) for event in self.events]


ALLOWED_TRANSITIONS = {
    "idle": {"running"},
    "running": {"completed", "failed", "cancelled"},
    "completed": set(),
    "failed": set(),
    "cancelled": set(),
}


def transition(current: RunState, next_state: RunState) -> RunState:
    if next_state.status not in ALLOWED_TRANSITIONS[current.status]:
        raise ValueError(f"invalid transition: {current.status} -> {next_state.status}")
    return next_state


def parse_message(value: object) -> HarnessMessage:
    if not isinstance(value, dict):
        raise ValueError("message must be an object")
    kind = value.get("kind")
    text = value.get("text")
    if kind not in {"user", "assistant", "progress"} or not isinstance(text, str):
        raise ValueError("invalid message")
    return {"kind": kind, "text": text}  # type: ignore[return-value]


class ResourceScope:
    def __init__(self) -> None:
        self._disposers: list[Callable[[], object | Awaitable[object]]] = []
        self._disposed = False

    def register(self, disposer: Callable[[], object | Awaitable[object]]) -> None:
        if self._disposed:
            raise RuntimeError("resource scope already disposed")
        self._disposers.append(disposer)

    async def dispose(self) -> None:
        if self._disposed:
            return
        self._disposed = True
        for disposer in reversed(self._disposers):
            result = disposer()
            if asyncio.iscoroutine(result):
                await result
        self._disposers.clear()


class CancellationScope:
    def __init__(self) -> None:
        self._event = asyncio.Event()
        self.reason = ""
        self._callbacks: list[Callable[[str], None]] = []

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def cancel(self, reason: str) -> None:
        if self.cancelled:
            return
        self.reason = reason
        self._event.set()
        for callback in tuple(self._callbacks):
            callback(reason)

    async def wait(self) -> None:
        await self._event.wait()

    def add_callback(self, callback: Callable[[str], None]) -> Callable[[], None]:
        self._callbacks.append(callback)
        if self.cancelled:
            callback(self.reason)

        def remove() -> None:
            if callback in self._callbacks:
                self._callbacks.remove(callback)

        return remove


@dataclass(frozen=True)
class ProcessInputResult:
    messages: list[HarnessMessage]
    should_query: bool


ProcessInput = Callable[
    [str, Sequence[HarnessMessage]], Awaitable[ProcessInputResult]
]
QueryStream = Callable[
    [Sequence[HarnessMessage], CancellationScope], AsyncIterator[HarnessMessage]
]


class H0Harness:
    def __init__(self, process_input: ProcessInput, query_stream: QueryStream) -> None:
        self._process_input = process_input
        self._query_stream = query_stream
        self._messages: list[HarnessMessage] = []
        self.state = RunState("idle")
        self.trace = TraceLog()

    @property
    def messages(self) -> list[HarnessMessage]:
        return list(self._messages)

    def _set_state(self, next_state: RunState) -> None:
        self.state = transition(self.state, next_state)
        self.trace.record("run.state", status=next_state.status)

    async def run(
        self, prompt: str, cancellation: CancellationScope | None = None
    ) -> AsyncIterator[HarnessMessage]:
        active_cancel = cancellation or CancellationScope()
        resources = ResourceScope()
        remove_callback = active_cancel.add_callback(
            lambda reason: self.trace.record("cancel.requested", reason=reason)
        )
        resources.register(remove_callback)

        self._set_state(RunState("running"))
        try:
            self.trace.record(
                "call.entered", source="H0Harness.run", target="processInput"
            )
            processed = await self._process_input(prompt, list(self._messages))
            for message in processed.messages:
                self._messages.append(message)
                self.trace.record(
                    "message.appended",
                    owner="H0Harness",
                    kind=message["kind"],
                    size=len(self._messages),
                )
            request_view = list(self._messages)
            self.trace.record(
                "view.snapshotted", owner="H0Harness", size=len(request_view)
            )

            if active_cancel.cancelled:
                self._set_state(RunState("cancelled", reason=active_cancel.reason))
                return
            if not processed.should_query:
                self.trace.record(
                    "branch.skipped",
                    branch="query",
                    reason="processInput.shouldQuery=false",
                )
                self._set_state(RunState("completed"))
                return

            self.trace.record(
                "call.entered", source="H0Harness.run", target="queryStream"
            )
            async for message in self._query_stream(request_view, active_cancel):
                if active_cancel.cancelled:
                    break
                self.trace.record("query.event", kind=message["kind"])
                self._messages.append(message)
                self.trace.record(
                    "message.appended",
                    owner="H0Harness",
                    kind=message["kind"],
                    size=len(self._messages),
                )
                yield message

            if active_cancel.cancelled:
                self._set_state(RunState("cancelled", reason=active_cancel.reason))
            else:
                self._set_state(RunState("completed"))
        except Exception as error:
            self.trace.record("run.failed", message=str(error))
            self._set_state(RunState("failed", error=str(error)))
            raise
        finally:
            await resources.dispose()
            self.trace.record("cleanup.finished")


async def collect(stream: AsyncIterator[HarnessMessage]) -> list[HarnessMessage]:
    return [message async for message in stream]
