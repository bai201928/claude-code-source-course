from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Generic, Literal, Protocol, TypeVar, cast


@dataclass(frozen=True)
class UserMessage:
    kind: Literal["user"]
    id: str
    timestamp: str
    content: str


@dataclass(frozen=True)
class AssistantMessage:
    kind: Literal["assistant"]
    id: str
    timestamp: str
    blocks: list[dict[str, Any]]


@dataclass(frozen=True)
class ProgressMessage:
    kind: Literal["progress"]
    id: str
    timestamp: str
    tool_use_id: str
    completed: float


@dataclass(frozen=True)
class SystemMessage:
    kind: Literal["system"]
    id: str
    timestamp: str
    level: Literal["info", "warning", "error"]
    content: str


HarnessMessage = UserMessage | AssistantMessage | ProgressMessage | SystemMessage


def summarize_message(message: HarnessMessage) -> str:
    if isinstance(message, UserMessage):
        return f"user:{message.content}"
    if isinstance(message, AssistantMessage):
        return f"assistant:{len(message.blocks)}"
    if isinstance(message, ProgressMessage):
        return f"progress:{message.tool_use_id}:{message.completed}"
    return f"system:{message.level}:{message.content}"


def parse_message(value: object) -> HarnessMessage:
    if not isinstance(value, dict):
        raise ValueError("Message must be an object")
    message = cast(dict[str, Any], value)
    if not isinstance(message.get("id"), str) or not isinstance(
        message.get("timestamp"), str
    ):
        raise ValueError("Message base fields are invalid")

    kind = message.get("kind")
    if kind == "user" and isinstance(message.get("content"), str):
        return UserMessage(kind="user", id=message["id"], timestamp=message["timestamp"], content=message["content"])
    if kind == "assistant" and isinstance(message.get("blocks"), list):
        return AssistantMessage(kind="assistant", id=message["id"], timestamp=message["timestamp"], blocks=message["blocks"])
    if (
        kind == "progress"
        and isinstance(message.get("tool_use_id"), str)
        and isinstance(message.get("completed"), (int, float))
    ):
        return ProgressMessage(kind="progress", id=message["id"], timestamp=message["timestamp"], tool_use_id=message["tool_use_id"], completed=float(message["completed"]))
    if (
        kind == "system"
        and message.get("level") in {"info", "warning", "error"}
        and isinstance(message.get("content"), str)
    ):
        return SystemMessage(kind="system", id=message["id"], timestamp=message["timestamp"], level=message["level"], content=message["content"])
    raise ValueError(f"Invalid message variant: {kind}")


RunKind = Literal["idle", "running", "completed", "failed", "cancelled"]


@dataclass(frozen=True)
class RunState:
    kind: RunKind
    detail: str = ""


ALLOWED_TRANSITIONS: dict[RunKind, frozenset[RunKind]] = {
    "idle": frozenset({"running"}),
    "running": frozenset({"running", "completed", "failed", "cancelled"}),
    "completed": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
}


def transition_run_state(current: RunState, next_state: RunState) -> RunState:
    if next_state.kind not in ALLOWED_TRANSITIONS[current.kind]:
        raise ValueError(f"Illegal transition: {current.kind} -> {next_state.kind}")
    return next_state


InputT = TypeVar("InputT")
OutputT = TypeVar("OutputT")


class Tool(Protocol, Generic[InputT, OutputT]):
    name: str

    def validate_input(self, value: object) -> InputT: ...

    async def execute(self, value: InputT) -> OutputT: ...


async def execute_tool(tool: Tool[InputT, OutputT], raw_input: object) -> OutputT:
    validated = tool.validate_input(raw_input)
    return await tool.execute(validated)


@dataclass(frozen=True)
class WeatherInput:
    city: str


@dataclass(frozen=True)
class WeatherOutput:
    city: str
    temperature_c: int


class WeatherTool:
    name = "weather"

    def validate_input(self, value: object) -> WeatherInput:
        if not isinstance(value, dict) or not isinstance(value.get("city"), str):
            raise ValueError("Invalid input for tool weather")
        return WeatherInput(city=value["city"])

    async def execute(self, value: WeatherInput) -> WeatherOutput:
        return WeatherOutput(city=value.city, temperature_c=31)
