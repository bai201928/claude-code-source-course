from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from types import MappingProxyType
from typing import Awaitable, Callable, Literal, Mapping, Protocol
import json
import re


class CancellationView(Protocol):
    @property
    def cancelled(self) -> bool: ...
    def throw_if_cancelled(self) -> None: ...


@dataclass(frozen=True)
class McpServerCapabilities:
    tools: bool
    resources: bool
    prompts: bool


@dataclass(frozen=True)
class McpHandshake:
    server_name: str
    server_version: str
    capabilities: McpServerCapabilities
    instructions: str | None = None


@dataclass(frozen=True)
class McpRemoteTool:
    name: str
    description: str
    input_schema: Mapping[str, object]
    annotations: Mapping[str, object] | None = None


@dataclass(frozen=True)
class McpCallResult:
    content: object
    is_error: bool = False


class McpTransport(Protocol):
    async def connect(self, signal: CancellationView) -> McpHandshake: ...
    async def list_tools(
        self, signal: CancellationView
    ) -> tuple[McpRemoteTool, ...]: ...
    async def call_tool(
        self,
        tool_name: str,
        arguments: Mapping[str, object],
        *,
        signal: CancellationView,
        idempotency_key: str,
        timeout_ms: int,
    ) -> McpCallResult: ...
    async def close(self, reason: str) -> None: ...


@dataclass(frozen=True)
class McpVisibleTool:
    qualified_name: str
    remote_name: str
    description: str
    input_schema: Mapping[str, object]


@dataclass(frozen=True)
class McpCapabilitySnapshot:
    server_name: str
    generation: int
    revision: int
    capabilities: McpServerCapabilities
    tools: tuple[McpVisibleTool, ...]


@dataclass(frozen=True)
class McpSessionState:
    type: Literal["idle", "connecting", "ready", "degraded", "closed"]
    generation: int
    revision: int = 0
    reason: str | None = None


@dataclass(frozen=True)
class McpSessionTrace:
    action: Literal["connect", "refresh", "degrade", "disconnect", "call", "retry"]
    generation: int
    revision: int
    tool_count: int


class McpRetryPolicy(Protocol):
    def allow_session_recovery(self, tool: McpRemoteTool) -> bool: ...


class NoMcpRetryPolicy:
    def allow_session_recovery(self, _tool: McpRemoteTool) -> bool:
        return False


class McpSessionExpiredError(RuntimeError):
    pass


class StaleMcpSnapshotError(RuntimeError):
    pass


class IndeterminateMcpOutcomeError(RuntimeError):
    pass


class McpSession:
    def __init__(
        self,
        factory: Callable[[], McpTransport],
        *,
        retry_policy: McpRetryPolicy | None = None,
        timeout_ms: int = 60_000,
    ) -> None:
        if timeout_ms <= 0:
            raise ValueError("MCP timeout must be positive")
        self._factory = factory
        self._retry_policy = retry_policy or NoMcpRetryPolicy()
        self._timeout_ms = timeout_ms
        self._state = McpSessionState("idle", 0)
        self._revision = 0
        self._transport: McpTransport | None = None
        self._handshake: McpHandshake | None = None
        self._tools: tuple[McpRemoteTool, ...] = ()
        self._traces: list[McpSessionTrace] = []

    @property
    def state(self) -> McpSessionState:
        return self._state

    async def connect(self, signal: CancellationView) -> McpCapabilitySnapshot:
        signal.throw_if_cancelled()
        if self._state.type == "closed":
            raise RuntimeError("MCP session is closed")
        generation = self._state.generation + 1
        self._state = McpSessionState("connecting", generation, self._revision)
        candidate = self._factory()
        try:
            handshake = _validate_handshake(await candidate.connect(signal))
            signal.throw_if_cancelled()
            tools = (
                _validate_tools(await candidate.list_tools(signal))
                if handshake.capabilities.tools
                else ()
            )
            signal.throw_if_cancelled()
            if self._transport is not None:
                await self._transport.close("replaced by newer MCP generation")
            self._transport = candidate
            self._handshake = handshake
            self._tools = tools
            self._revision += 1
            self._state = McpSessionState("ready", generation, self._revision)
            self._record("connect")
            return self.snapshot()
        except Exception as error:
            try:
                await candidate.close("MCP initialization failed")
            except Exception:
                pass
            self._state = McpSessionState(
                "degraded", generation, self._revision, type(error).__name__
            )
            self._record("degrade")
            raise

    def snapshot(self) -> McpCapabilitySnapshot:
        if self._state.type != "ready" or self._handshake is None:
            raise RuntimeError("MCP session is not ready")
        return McpCapabilitySnapshot(
            self._handshake.server_name,
            self._state.generation,
            self._revision,
            self._handshake.capabilities,
            tuple(
                McpVisibleTool(
                    _qualify(self._handshake.server_name, tool.name),
                    tool.name,
                    tool.description,
                    _freeze_mapping(tool.input_schema),
                )
                for tool in self._tools
            ),
        )

    async def handle_tools_changed(
        self, signal: CancellationView
    ) -> McpCapabilitySnapshot:
        if self._state.type != "ready" or self._transport is None:
            raise RuntimeError("MCP session is not ready")
        try:
            tools = _validate_tools(await self._transport.list_tools(signal))
            signal.throw_if_cancelled()
            self._tools = tools
            self._revision += 1
            self._state = McpSessionState(
                "ready", self._state.generation, self._revision
            )
            self._record("refresh")
            return self.snapshot()
        except Exception as error:
            self._state = McpSessionState(
                "degraded",
                self._state.generation,
                self._revision,
                type(error).__name__,
            )
            self._record("degrade")
            raise

    async def call(
        self,
        snapshot: McpCapabilitySnapshot,
        qualified_name: str,
        arguments: Mapping[str, object],
        call_id: str,
        signal: CancellationView,
    ) -> McpCallResult:
        tool = self._assert_callable(snapshot, qualified_name)
        idempotency_key = (
            f"{snapshot.server_name}:{snapshot.generation}:{call_id}"
        )
        try:
            assert self._transport is not None
            result = await self._transport.call_tool(
                tool.name,
                _freeze_mapping(arguments),
                signal=signal,
                idempotency_key=idempotency_key,
                timeout_ms=self._timeout_ms,
            )
            self._record("call")
            return result
        except McpSessionExpiredError as error:
            if not self._retry_policy.allow_session_recovery(tool):
                raise IndeterminateMcpOutcomeError(
                    f"MCP call outcome is indeterminate and retry is not approved: {qualified_name}"
                ) from error
            recovered = await self.connect(signal)
            recovered_tool = next(
                (
                    item
                    for item in self._tools
                    if _qualify(recovered.server_name, item.name) == qualified_name
                ),
                None,
            )
            if recovered_tool is None or _stable_schema(
                recovered_tool.input_schema
            ) != _stable_schema(tool.input_schema):
                raise IndeterminateMcpOutcomeError(
                    "MCP tool changed during session recovery"
                )
            self._record("retry")
            assert self._transport is not None
            return await self._transport.call_tool(
                recovered_tool.name,
                _freeze_mapping(arguments),
                signal=signal,
                idempotency_key=idempotency_key,
                timeout_ms=self._timeout_ms,
            )

    async def disconnect(self, reason: str = "MCP disconnect") -> None:
        if self._transport is not None:
            await self._transport.close(reason)
        self._transport = None
        self._handshake = None
        self._tools = ()
        self._state = McpSessionState("idle", self._state.generation, self._revision)
        self._record("disconnect")

    def traces(self) -> tuple[McpSessionTrace, ...]:
        return tuple(self._traces)

    def _assert_callable(
        self, snapshot: McpCapabilitySnapshot, qualified_name: str
    ) -> McpRemoteTool:
        if (
            self._state.type != "ready"
            or self._transport is None
            or self._handshake is None
        ):
            raise RuntimeError("MCP session is not ready")
        if (
            snapshot.generation != self._state.generation
            or snapshot.revision != self._revision
        ):
            raise StaleMcpSnapshotError("MCP capability snapshot is stale")
        descriptor = next(
            (item for item in snapshot.tools if item.qualified_name == qualified_name),
            None,
        )
        if descriptor is None:
            raise ValueError(f"MCP tool is not visible: {qualified_name}")
        tool = next(
            (item for item in self._tools if item.name == descriptor.remote_name),
            None,
        )
        if tool is None:
            raise ValueError(f"MCP tool has no remote handler: {qualified_name}")
        return tool

    def _record(self, action) -> None:
        self._traces.append(
            McpSessionTrace(
                action,
                self._state.generation,
                self._revision,
                len(self._tools),
            )
        )


def _validate_handshake(value: McpHandshake) -> McpHandshake:
    _require_text(value.server_name, "MCP server name")
    _require_text(value.server_version, "MCP server version")
    return value


def _validate_tools(
    tools: tuple[McpRemoteTool, ...]
) -> tuple[McpRemoteTool, ...]:
    names: set[str] = set()
    frozen: list[McpRemoteTool] = []
    for tool in tools:
        _require_text(tool.name, "MCP tool name")
        _require_text(tool.description, "MCP tool description")
        if tool.name in names:
            raise ValueError(f"duplicate MCP tool: {tool.name}")
        names.add(tool.name)
        if tool.input_schema.get("type") not in (None, "object"):
            raise ValueError(
                f"MCP tool schema must describe an object: {tool.name}"
            )
        frozen.append(
            McpRemoteTool(
                tool.name,
                tool.description,
                _freeze_mapping(tool.input_schema),
                _freeze_mapping(tool.annotations) if tool.annotations else None,
            )
        )
    return tuple(frozen)


def _qualify(server_name: str, tool_name: str) -> str:
    return f"mcp__{_normalize(server_name)}__{_normalize(tool_name)}"


def _normalize(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "_", value)


def _stable_schema(value: Mapping[str, object]) -> str:
    return json.dumps(dict(value), sort_keys=True, separators=(",", ":"))


def _freeze_mapping(value: Mapping[str, object]) -> Mapping[str, object]:
    return MappingProxyType(deepcopy(dict(value)))


def _require_text(value: str, label: str) -> None:
    if not value.strip():
        raise ValueError(f"{label} must not be empty")
