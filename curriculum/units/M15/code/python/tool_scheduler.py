from __future__ import annotations

import asyncio
import inspect
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal


@dataclass(frozen=True)
class Call:
    call_id: str
    name: str
    tool_input: Mapping[str, object]


@dataclass(frozen=True)
class Tool:
    name: str
    parse: Callable[[Mapping[str, object]], Mapping[str, object]]
    is_concurrency_safe: Callable[[Mapping[str, object]], bool]
    permission: Callable[[Mapping[str, object]], Literal["allow", "deny"]]
    run: Callable[
        [Mapping[str, object], Callable[[str], None], asyncio.Event],
        tuple[str, Mapping[str, str] | None]
        | Awaitable[tuple[str, Mapping[str, str] | None]],
    ]


@dataclass(frozen=True)
class Batch:
    mode: Literal["concurrent", "exclusive"]
    calls: tuple[Call, ...]


@dataclass(frozen=True)
class Outcome:
    call_id: str
    status: Literal["success", "error", "denied", "cancelled"]
    output: str
    update: Mapping[str, str] | None = None


class Scheduler:
    def __init__(self, tools: Sequence[Tool], limit: int = 2) -> None:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise ValueError("limit must be positive")
        self._tools = {tool.name: tool for tool in tools}
        self._limit = limit

    def plan(self, calls: Sequence[Call]) -> tuple[Batch, ...]:
        batches: list[Batch] = []
        safe: list[Call] = []

        def flush() -> None:
            if safe:
                batches.append(Batch("concurrent", tuple(safe)))
                safe.clear()

        for call in calls:
            if self._classify(call):
                safe.append(call)
            else:
                flush()
                batches.append(Batch("exclusive", (call,)))
        flush()
        return tuple(batches)

    async def execute(
        self,
        calls: Sequence[Call],
        cancelled: asyncio.Event,
        on_progress: Callable[[str, str], None] = lambda _call_id, _stage: None,
    ) -> tuple[tuple[Outcome, ...], Mapping[str, str]]:
        outcomes: dict[str, Outcome] = {}
        context: dict[str, str] = {}
        for batch in self.plan(calls):
            if batch.mode == "exclusive":
                completed = (
                    await self._one(batch.calls[0], cancelled, on_progress),
                )
            else:
                completed = await self._concurrent(
                    batch.calls, cancelled, on_progress
                )
            outcomes.update((outcome.call_id, outcome) for outcome in completed)
            for call in batch.calls:
                update = outcomes[call.call_id].update
                if update is not None:
                    context.update(update)
        return tuple(outcomes[call.call_id] for call in calls), MappingProxyType(context)

    def _classify(self, call: Call) -> bool:
        tool = self._tools.get(call.name)
        if tool is None:
            return False
        try:
            parsed = tool.parse(call.tool_input)
            return tool.is_concurrency_safe(parsed)
        except Exception:
            return False

    async def _concurrent(
        self,
        calls: tuple[Call, ...],
        cancelled: asyncio.Event,
        on_progress: Callable[[str, str], None],
    ) -> tuple[Outcome, ...]:
        outcomes: list[Outcome | None] = [None] * len(calls)
        next_index = 0
        lock = asyncio.Lock()

        async def worker() -> None:
            nonlocal next_index
            while True:
                async with lock:
                    index = next_index
                    next_index += 1
                if index >= len(calls):
                    return
                outcomes[index] = await self._one(
                    calls[index], cancelled, on_progress
                )

        await asyncio.gather(
            *(worker() for _ in range(min(self._limit, len(calls))))
        )
        return tuple(outcome for outcome in outcomes if outcome is not None)

    async def _one(
        self,
        call: Call,
        cancelled: asyncio.Event,
        on_progress: Callable[[str, str], None],
    ) -> Outcome:
        if cancelled.is_set():
            return Outcome(call.call_id, "cancelled", "cancelled before execution")
        tool = self._tools.get(call.name)
        if tool is None:
            return Outcome(call.call_id, "error", f"unknown tool: {call.name}")
        try:
            parsed = tool.parse(call.tool_input)
        except Exception as error:
            return Outcome(call.call_id, "error", str(error))
        if tool.permission(parsed) == "deny":
            return Outcome(call.call_id, "denied", "permission denied")
        try:
            produced = tool.run(
                parsed,
                lambda stage: on_progress(call.call_id, stage),
                cancelled,
            )
            output, update = (
                await produced if inspect.isawaitable(produced) else produced
            )
            if cancelled.is_set():
                return Outcome(call.call_id, "cancelled", "cancelled during execution")
            return Outcome(call.call_id, "success", output, update)
        except Exception as error:
            return Outcome(
                call.call_id,
                "cancelled" if cancelled.is_set() else "error",
                str(error),
            )


def compare_snapshot_policies(
    calls: Sequence[tuple[bool, Mapping[str, str] | None]],
) -> tuple[Mapping[str, str], Mapping[str, str]]:
    response_complete: dict[str, str] = {}
    streaming: dict[str, str] = {}
    for safe, update in calls:
        if update is None:
            continue
        response_complete.update(update)
        if not safe:
            streaming.update(update)
    return MappingProxyType(response_complete), MappingProxyType(streaming)
