from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncIterator, Literal


@dataclass(frozen=True)
class HarnessEvent:
    type: Literal["run.started", "model.delta", "run.completed"]
    value: str


async def run_event_stream(
    run_id: str, trace: list[str], fail_after_delta: bool = False
) -> AsyncIterator[HarnessEvent]:
    trace.append("producer.started")
    try:
        trace.append("producer.before:start")
        yield HarnessEvent("run.started", run_id)
        trace.append("producer.after:start")
        trace.append("producer.before:delta")
        yield HarnessEvent("model.delta", "hello")
        trace.append("producer.after:delta")
        if fail_after_delta:
            raise RuntimeError("scripted producer failure")
        trace.append("producer.before:complete")
        yield HarnessEvent("run.completed", run_id)
        trace.append("producer.after:complete")
    finally:
        trace.append("producer.finally")


class PushAsyncQueue:
    def __init__(self) -> None:
        self._queue: list[int] = []
        self._closed = False

    @property
    def buffered_count(self) -> int:
        return len(self._queue)

    def enqueue(self, value: int) -> None:
        if self._closed:
            raise RuntimeError("queue is closed")
        self._queue.append(value)

    def done(self) -> None:
        self._closed = True

    def __aiter__(self) -> PushAsyncQueue:
        return self

    async def __anext__(self) -> int:
        if self._queue:
            return self._queue.pop(0)
        if self._closed:
            raise StopAsyncIteration
        raise RuntimeError("teaching queue has no pending waiter implementation")
