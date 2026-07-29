from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Literal


@dataclass(frozen=True)
class ProcessEvent:
    type: str
    detail: str


@dataclass
class ProcessResult:
    status: Literal["completed", "failed", "cancelled", "timed_out"]
    stdout: str
    stderr: str
    exit_code: int
    events: list[ProcessEvent] = field(default_factory=list)


class ResourceScope:
    def __init__(self) -> None:
        self._disposers: list[Callable[[], Awaitable[None] | None]] = []
        self._disposed = False

    def register(self, disposer: Callable[[], Awaitable[None] | None]) -> None:
        if self._disposed:
            raise RuntimeError("scope already disposed")
        self._disposers.append(disposer)

    async def dispose(self) -> None:
        if self._disposed:
            return
        self._disposed = True
        for disposer in reversed(self._disposers):
            result = disposer()
            if result is not None:
                await result
        self._disposers.clear()


async def observe_event_loop() -> list[str]:
    loop = asyncio.get_running_loop()
    trace = ["sync"]
    loop.call_soon(trace.append, "call_soon")
    loop.call_later(0, trace.append, "timer")
    await asyncio.sleep(0.01)
    return trace


CHILD_PROGRAM = """
import sys, time
count = int(sys.argv[1])
interval = float(sys.argv[2])
for current in range(1, count + 1):
    print(f'tick:{current}', flush=True)
    if current == 2:
        print('diagnostic:2', file=sys.stderr, flush=True)
    time.sleep(interval)
"""


async def _read_stream(
    stream: asyncio.StreamReader,
    event_type: str,
    events: list[ProcessEvent],
    on_stdout: Callable[[str], None] | None = None,
) -> str:
    chunks: list[str] = []
    while line := await stream.readline():
        text = line.decode()
        chunks.append(text)
        events.append(ProcessEvent(event_type, text))
        if event_type == "process.stdout" and on_stdout is not None:
            on_stdout(text)
    return "".join(chunks)


async def run_child_process(
    *,
    count: int = 3,
    interval_seconds: float = 0.02,
    cancel_event: asyncio.Event | None = None,
    timeout_seconds: float | None = None,
    on_stdout: Callable[[str], None] | None = None,
) -> ProcessResult:
    events: list[ProcessEvent] = []
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-u",
        "-c",
        CHILD_PROGRAM,
        str(count),
        str(interval_seconds),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    events.append(ProcessEvent("process.started", str(process.pid)))
    assert process.stdout is not None and process.stderr is not None
    stdout_task = asyncio.create_task(
        _read_stream(process.stdout, "process.stdout", events, on_stdout)
    )
    stderr_task = asyncio.create_task(
        _read_stream(process.stderr, "process.stderr", events)
    )
    wait_task = asyncio.create_task(process.wait())
    cancel_task = (
        asyncio.create_task(cancel_event.wait()) if cancel_event is not None else None
    )

    status: Literal["completed", "failed", "cancelled", "timed_out"]
    reason: str | None = None
    waiters = {wait_task}
    if cancel_task is not None:
        waiters.add(cancel_task)
    done, _ = await asyncio.wait(
        waiters,
        timeout=timeout_seconds,
        return_when=asyncio.FIRST_COMPLETED,
    )
    if wait_task not in done:
        reason = "external" if cancel_task is not None and cancel_task in done else "timeout"
        events.append(ProcessEvent("cancel.requested", reason))
        process.terminate()
        try:
            await asyncio.wait_for(asyncio.shield(wait_task), 0.5)
        except asyncio.TimeoutError:
            process.kill()
            await wait_task

    exit_code = wait_task.result()
    events.append(ProcessEvent("process.exited", str(exit_code)))
    stdout, stderr = await asyncio.gather(stdout_task, stderr_task)
    if cancel_task is not None and not cancel_task.done():
        cancel_task.cancel()

    status = (
        "timed_out"
        if reason == "timeout"
        else "cancelled"
        if reason is not None
        else "completed"
        if exit_code == 0
        else "failed"
    )
    events.append(ProcessEvent("cleanup.finished", ""))
    return ProcessResult(status, stdout, stderr, exit_code, events)
