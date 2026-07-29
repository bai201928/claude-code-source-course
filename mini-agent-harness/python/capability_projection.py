from __future__ import annotations

from dataclasses import dataclass
import re
from types import MappingProxyType
from typing import Callable, Literal, Mapping

CapabilitySource = Literal["builtin", "plugin", "mcp", "dynamic", "policy"]
ProjectionReason = Literal[
    "included",
    "hidden-by-policy",
    "mode-mismatch",
    "provider-mismatch",
    "model-mismatch",
    "deferred-until-discovered",
]


@dataclass(frozen=True)
class CapabilityDefinition:
    name: str
    description: str
    source: CapabilitySource
    priority: float
    deferred: bool = False
    modes: tuple[str, ...] = ()
    providers: tuple[str, ...] = ()
    models: tuple[str, ...] = ()


@dataclass(frozen=True)
class CatalogSnapshot:
    revision: int
    capabilities: tuple[CapabilityDefinition, ...]


class CapabilityCatalog:
    def __init__(self) -> None:
        self._revision = 0
        self._definitions: dict[str, CapabilityDefinition] = {}

    def publish(self, definitions: list[CapabilityDefinition]) -> CatalogSnapshot:
        next_definitions = dict(self._definitions)
        for definition in definitions:
            _validate_definition(definition)
            current = next_definitions.get(definition.name)
            if current is None or definition.priority > current.priority:
                next_definitions[definition.name] = definition
        self._definitions = next_definitions
        self._revision += 1
        return self.snapshot()

    def snapshot(self) -> CatalogSnapshot:
        return CatalogSnapshot(
            self._revision,
            tuple(sorted(self._definitions.values(), key=lambda item: item.name)),
        )


@dataclass(frozen=True)
class ProjectionDecision:
    name: str
    source: CapabilitySource
    included: bool
    reason: ProjectionReason


@dataclass(frozen=True)
class ToolSchema:
    name: str
    description: str
    source: CapabilitySource


@dataclass(frozen=True)
class CapabilitySnapshot:
    catalog_revision: int
    boundary: str
    mode: str
    provider: str
    model: str
    schemas: tuple[ToolSchema, ...]
    decisions: tuple[ProjectionDecision, ...]


@dataclass(frozen=True)
class ProjectionOptions:
    boundary: str
    mode: str
    provider: str
    model: str
    policy_hidden_names: frozenset[str] = frozenset()
    discovered_deferred_names: frozenset[str] = frozenset()


class CapabilityProjector:
    def project(
        self, catalog: CatalogSnapshot, options: ProjectionOptions
    ) -> CapabilitySnapshot:
        _require_non_empty(options.boundary, "boundary")
        _require_non_empty(options.mode, "mode")
        _require_non_empty(options.provider, "provider")
        _require_non_empty(options.model, "model")
        decisions = tuple(_decide(item, options) for item in catalog.capabilities)
        schemas = tuple(
            ToolSchema(item.name, item.description, item.source)
            for item, decision in zip(catalog.capabilities, decisions, strict=True)
            if decision.included
        )
        return CapabilitySnapshot(
            catalog.revision,
            options.boundary,
            options.mode,
            options.provider,
            options.model,
            schemas,
            decisions,
        )


class ExecutableRegistry:
    def __init__(self) -> None:
        self._handlers: dict[str, Callable[[object], object]] = {}

    def register(self, name: str, handler: Callable[[object], object]) -> None:
        _require_non_empty(name, "tool name")
        if name in self._handlers:
            raise ValueError(f"executable already registered: {name}")
        self._handlers[name] = handler

    def names(self) -> tuple[str, ...]:
        return tuple(sorted(self._handlers))

    def dispatch(
        self, snapshot: CapabilitySnapshot, name: str, input_value: object
    ) -> object:
        if not any(schema.name == name for schema in snapshot.schemas):
            raise ValueError(
                f"tool is not visible in boundary {snapshot.boundary}: {name}"
            )
        handler = self._handlers.get(name)
        if handler is None:
            raise ValueError(f"visible tool has no executable handler: {name}")
        return handler(input_value)


@dataclass(frozen=True)
class BuiltSystemContext:
    system_prompt: tuple[str, ...]
    meta_user_context: Mapping[str, str]
    system_context: Mapping[str, str]
    base: Literal["default", "custom"]


class SystemContextBuilder:
    def build(
        self,
        *,
        default_prompt: list[str],
        custom_prompt: str | None = None,
        append_prompt: str | None = None,
        user_context: Mapping[str, str] | None = None,
        system_context: Mapping[str, str] | None = None,
    ) -> BuiltSystemContext:
        custom = custom_prompt.strip() if custom_prompt else ""
        appended = append_prompt.strip() if append_prompt else ""
        base = (custom,) if custom else tuple(default_prompt)
        effective = base + ((appended,) if appended else ())
        if not effective:
            raise ValueError("an effective system prompt is required")
        return BuiltSystemContext(
            effective,
            MappingProxyType(dict(user_context or {})),
            MappingProxyType(dict(system_context or {})),
            "custom" if custom else "default",
        )


def _decide(
    definition: CapabilityDefinition, options: ProjectionOptions
) -> ProjectionDecision:
    reason: ProjectionReason = "included"
    if definition.name in options.policy_hidden_names:
        reason = "hidden-by-policy"
    elif definition.modes and options.mode not in definition.modes:
        reason = "mode-mismatch"
    elif definition.providers and options.provider not in definition.providers:
        reason = "provider-mismatch"
    elif definition.models and options.model not in definition.models:
        reason = "model-mismatch"
    elif (
        definition.deferred
        and definition.name not in options.discovered_deferred_names
    ):
        reason = "deferred-until-discovered"
    return ProjectionDecision(
        definition.name, definition.source, reason == "included", reason
    )


def _validate_definition(definition: CapabilityDefinition) -> None:
    _require_non_empty(definition.name, "capability name")
    _require_non_empty(definition.description, "capability description")
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:-]*", definition.name) is None:
        raise ValueError(
            "capability name must use the portable ASCII identifier form"
        )
    if definition.priority != definition.priority or definition.priority in (
        float("inf"),
        float("-inf"),
    ):
        raise ValueError("capability priority must be finite")


def _require_non_empty(value: str, name: str) -> None:
    if not value.strip():
        raise ValueError(f"{name} must not be empty")
