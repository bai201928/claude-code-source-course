from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass
from typing import Literal, Protocol, TypedDict


class RuntimeCommand(TypedDict):
    type: Literal["prompt"]
    text: str


class ProgressEvent(TypedDict):
    type: Literal["progress"]
    text: str


class ResultEvent(TypedDict):
    type: Literal["result"]
    text: str


class FailureEvent(TypedDict):
    type: Literal["failure"]
    message: str


DomainEvent = ProgressEvent | ResultEvent | FailureEvent


class RuntimeCore(Protocol):
    def run(self, command: RuntimeCommand) -> AsyncIterator[DomainEvent]: ...


@dataclass(frozen=True)
class SurfaceTraceEvent:
    seq: int
    type: str
    details: dict[str, object]


class SurfaceTrace:
    def __init__(self) -> None:
        self.events: list[SurfaceTraceEvent] = []

    def record(self, event_type: str, **details: object) -> None:
        self.events.append(SurfaceTraceEvent(len(self.events) + 1, event_type, details))

    def to_dicts(self) -> list[dict[str, object]]:
        return [asdict(event) for event in self.events]


@dataclass(frozen=True)
class SurfaceRun:
    events: list[DomainEvent]
    output: list[str]


def _prompt_command(text: str) -> RuntimeCommand:
    if not text.strip():
        raise ValueError("prompt must not be empty")
    return {"type": "prompt", "text": text}


class _BaseSurface:
    def __init__(self, surface: Literal["interactive", "headless"], core: RuntimeCore) -> None:
        self.surface = surface
        self.core = core
        self.trace = SurfaceTrace()
        self._opened = False
        self._closed = False

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError(f"{self.surface} surface is closed")
        if not self._opened:
            self._opened = True
            self.trace.record("surface.opened", surface=self.surface)

    async def _call_core(self, command: RuntimeCommand) -> list[DomainEvent]:
        self.trace.record("core.called", surface=self.surface)
        events: list[DomainEvent] = []
        async for event in self.core.run(command):
            events.append(event)
            self.trace.record(
                "event.received", surface=self.surface, event=event["type"]
            )
        return events

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self.trace.record("surface.closed", surface=self.surface)


def _project_interactive(event: DomainEvent) -> str:
    event_type = event.get("type")
    if event_type == "progress":
        return f"status: {event['text']}"
    if event_type == "result":
        return f"assistant: {event['text']}"
    if event_type == "failure":
        return f"error: {event['message']}"
    raise ValueError(f"unknown surface value: {event!r}")


class InteractiveSurface(_BaseSurface):
    def __init__(self, core: RuntimeCore) -> None:
        super().__init__("interactive", core)

    async def submit(self, prompt: str) -> SurfaceRun:
        self._ensure_open()
        try:
            command = _prompt_command(prompt)
        except ValueError as error:
            self.trace.record(
                "input.rejected", surface=self.surface, reason=str(error)
            )
            raise
        self.trace.record("input.accepted", surface=self.surface)
        events = await self._call_core(command)
        output = [_project_interactive(event) for event in events]
        for _line in output:
            self.trace.record(
                "output.projected", surface=self.surface, format="display"
            )
        return SurfaceRun(events, output)


def _parse_stream_commands(payload: str) -> list[RuntimeCommand]:
    lines = [line for line in payload.splitlines() if line]
    if not lines:
        raise ValueError("stream input must contain a message")
    commands: list[RuntimeCommand] = []
    for line in lines:
        try:
            value = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError("invalid NDJSON") from error
        if not isinstance(value, dict):
            raise ValueError("invalid user message")
        message = value.get("message")
        if (
            value.get("type") != "user"
            or not isinstance(message, dict)
            or message.get("role") != "user"
            or not isinstance(message.get("content"), str)
        ):
            raise ValueError("invalid user message")
        commands.append(_prompt_command(message["content"]))
    return commands


def _project_text(events: list[DomainEvent]) -> list[str]:
    terminal = next(
        (event for event in reversed(events) if event.get("type") != "progress"), None
    )
    if terminal is None:
        raise ValueError("headless run produced no terminal event")
    event_type = terminal.get("type")
    if event_type == "result":
        return [terminal["text"]]
    if event_type == "failure":
        return [f"Execution error: {terminal['message']}"]
    raise ValueError(f"unknown surface value: {terminal!r}")


def _project_headless(
    events: list[DomainEvent], output_format: Literal["text", "json", "stream-json"]
) -> list[str]:
    if output_format == "text":
        return _project_text(events)
    if output_format == "json":
        return [json.dumps({"type": "result", "events": events}, separators=(",", ":"))]
    if output_format == "stream-json":
        return [json.dumps(event, separators=(",", ":")) + "\n" for event in events]
    raise ValueError(f"unknown output format: {output_format}")


class HeadlessSurface(_BaseSurface):
    def __init__(self, core: RuntimeCore) -> None:
        super().__init__("headless", core)

    async def submit(
        self,
        payload: str,
        *,
        input_format: Literal["text", "stream-json"],
        output_format: Literal["text", "json", "stream-json"],
    ) -> SurfaceRun:
        self._ensure_open()
        try:
            commands = (
                [_prompt_command(payload)]
                if input_format == "text"
                else _parse_stream_commands(payload)
            )
        except ValueError as error:
            self.trace.record(
                "input.rejected", surface=self.surface, reason=str(error)
            )
            raise

        events: list[DomainEvent] = []
        for command in commands:
            self.trace.record("input.accepted", surface=self.surface)
            events.extend(await self._call_core(command))
        output = _project_headless(events, output_format)
        for _line in output:
            self.trace.record(
                "output.projected", surface=self.surface, format=output_format
            )
        return SurfaceRun(events, output)

