from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Literal, Mapping, Sequence

SettingSource = Literal[
    "userSettings",
    "projectSettings",
    "localSettings",
    "flagSettings",
    "policySettings",
]
OrdinarySettingSource = Literal[
    "userSettings", "projectSettings", "localSettings"
]
ConfigurationSource = Literal[
    "pluginSettings",
    "userSettings",
    "projectSettings",
    "localSettings",
    "flagSettings",
    "policySettings",
]
PolicyProviderName = Literal["remote", "mdm", "managedFile", "hkcu"]

SETTING_SOURCE_ORDER: tuple[SettingSource, ...] = (
    "userSettings",
    "projectSettings",
    "localSettings",
    "flagSettings",
    "policySettings",
)

DEFAULT_SAFE_ENV_VARS = frozenset(
    {
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    }
)


@dataclass(frozen=True)
class SourceInput:
    settings: dict[str, Any]
    valid: bool = True
    error: str | None = None


@dataclass(frozen=True)
class PolicyProvider(SourceInput):
    name: PolicyProviderName = "remote"


@dataclass(frozen=True)
class ConfigurationProvenance:
    leaves: Mapping[str, ConfigurationSource]
    array_items: Mapping[str, ConfigurationSource]


@dataclass(frozen=True)
class ConfigurationSnapshot:
    revision: int
    effective: Mapping[str, Any]
    provenance: ConfigurationProvenance
    source_order: tuple[SettingSource, ...]
    source_settings: Mapping[SettingSource, Mapping[str, Any]]
    policy_provider: PolicyProviderName | None
    errors: tuple[str, ...]


def derive_canonical_order(
    selected: Sequence[OrdinarySettingSource] | None = None,
) -> list[SettingSource]:
    enabled = None if selected is None else set(selected)
    return [
        source
        for source in SETTING_SOURCE_ORDER
        if source in ("flagSettings", "policySettings")
        or enabled is None
        or source in enabled
    ]


def derive_snapshot_compatible_order(
    selected: Sequence[OrdinarySettingSource] | None = None,
) -> list[SettingSource]:
    if selected is None:
        return list(SETTING_SOURCE_ORDER)
    result: list[SettingSource] = []
    for source in selected:
        if source not in result:
            result.append(source)
    for mandatory in ("policySettings", "flagSettings"):
        if mandatory not in result:
            result.append(mandatory)
    return result


def resolve_configuration(
    *,
    revision: int,
    selected_ordinary_sources: Sequence[OrdinarySettingSource] | None = None,
    order_mode: Literal["canonical", "snapshot-compatible"] = "canonical",
    source_order: Sequence[SettingSource] | None = None,
    plugin_settings: SourceInput | None = None,
    sources: Mapping[SettingSource, SourceInput] | None = None,
    flag_inline: SourceInput | None = None,
    policy_providers: Sequence[PolicyProvider] = (),
) -> ConfigurationSnapshot:
    errors: list[str] = []
    leaves: dict[str, ConfigurationSource] = {}
    array_items: dict[str, ConfigurationSource] = {}
    effective: dict[str, Any] = {}
    raw_sources: dict[SettingSource, dict[str, Any]] = {}
    sources = sources or {}

    if source_order is not None:
        order = _unique_sources(source_order)
    elif order_mode == "snapshot-compatible":
        order = derive_snapshot_compatible_order(selected_ordinary_sources)
    else:
        order = derive_canonical_order(selected_ordinary_sources)
    _require_mandatory_sources(order)

    plugin = _valid_source(plugin_settings, "pluginSettings", errors)
    if plugin:
        _merge_object(
            effective,
            plugin,
            "pluginSettings",
            "",
            leaves,
            array_items,
        )

    selected_policy = _select_policy_provider(policy_providers, errors)

    for source in order:
        settings: dict[str, Any] | None
        if source == "policySettings":
            settings = selected_policy.settings if selected_policy else None
        elif source == "flagSettings":
            settings = _combine_flag_settings(
                sources.get("flagSettings"), flag_inline, errors
            )
        else:
            settings = _valid_source(sources.get(source), source, errors)
        if not settings:
            continue
        raw_sources[source] = deepcopy(settings)
        _merge_object(effective, settings, source, "", leaves, array_items)

    frozen_sources = {
        source: _freeze_json(settings) for source, settings in raw_sources.items()
    }
    return ConfigurationSnapshot(
        revision=revision,
        effective=_freeze_json(effective),
        provenance=ConfigurationProvenance(
            MappingProxyType(dict(leaves)), MappingProxyType(dict(array_items))
        ),
        source_order=tuple(order),
        source_settings=MappingProxyType(frozen_sources),
        policy_provider=selected_policy.name if selected_policy else None,
        errors=tuple(errors),
    )


def project_environment(
    snapshot: ConfigurationSnapshot,
    phase: Literal["pre-trust", "trusted"],
    safe_env_vars: frozenset[str] = DEFAULT_SAFE_ENV_VARS,
) -> dict[str, str]:
    if phase == "trusted":
        return _read_string_env(snapshot.effective)

    result: dict[str, str] = {}
    for source in ("userSettings", "flagSettings", "policySettings"):
        result.update(_read_string_env(snapshot.source_settings.get(source)))
    for key, value in _read_string_env(snapshot.effective).items():
        if key.upper() in safe_env_vars:
            result[key] = value
    return result


def assert_editable_source(source: SettingSource) -> OrdinarySettingSource:
    if source in ("flagSettings", "policySettings"):
        raise ValueError(f"{source} is read-only inside the harness")
    return source


def thaw_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {key: thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [thaw_json(item) for item in value]
    return value


def _combine_flag_settings(
    file: SourceInput | None,
    inline: SourceInput | None,
    errors: list[str],
) -> dict[str, Any] | None:
    file_settings = _valid_source(file, "flagSettings file", errors)
    inline_settings = _valid_source(inline, "flagSettings inline", errors)
    if file_settings is None and inline_settings is None:
        return None
    combined: dict[str, Any] = {}
    leaves: dict[str, ConfigurationSource] = {}
    items: dict[str, ConfigurationSource] = {}
    if file_settings:
        _merge_object(
            combined, file_settings, "flagSettings", "", leaves, items
        )
    if inline_settings:
        _merge_object(
            combined, inline_settings, "flagSettings", "", leaves, items
        )
    return combined


def _select_policy_provider(
    providers: Sequence[PolicyProvider], errors: list[str]
) -> PolicyProvider | None:
    for provider in providers:
        if not provider.valid:
            errors.append(provider.error or f"{provider.name} policy is invalid")
            continue
        if provider.settings:
            return provider
    return None


def _valid_source(
    value: SourceInput | None, label: str, errors: list[str]
) -> dict[str, Any] | None:
    if value is None:
        return None
    if not value.valid:
        errors.append(value.error or f"{label} settings are invalid")
        return None
    return value.settings


def _merge_object(
    target: dict[str, Any],
    incoming: Mapping[str, Any],
    source: ConfigurationSource,
    prefix: str,
    leaves: dict[str, ConfigurationSource],
    array_items: dict[str, ConfigurationSource],
) -> None:
    for key, value in incoming.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, list):
            existing = target.get(key)
            if isinstance(existing, list):
                output = existing
            else:
                _clear_path(path, leaves, array_items)
                output = []
            for item in value:
                if any(_same_value_zero(previous, item) for previous in output):
                    continue
                index = len(output)
                output.append(deepcopy(item))
                array_items[f"{path}[{index}]"] = source
            target[key] = output
        elif isinstance(value, dict):
            if not isinstance(target.get(key), dict):
                _clear_path(path, leaves, array_items)
                target[key] = {}
            _merge_object(
                target[key], value, source, path, leaves, array_items
            )
        else:
            _clear_path(path, leaves, array_items)
            target[key] = value
            leaves[path] = source


def _clear_path(
    prefix: str,
    leaves: dict[str, ConfigurationSource],
    array_items: dict[str, ConfigurationSource],
) -> None:
    for collection in (leaves, array_items):
        for key in list(collection):
            if _belongs_to_path(key, prefix):
                del collection[key]


def _belongs_to_path(candidate: str, prefix: str) -> bool:
    return (
        candidate == prefix
        or candidate.startswith(prefix + ".")
        or candidate.startswith(prefix + "[")
    )


def _same_value_zero(left: Any, right: Any) -> bool:
    if isinstance(left, (dict, list)) or isinstance(right, (dict, list)):
        return left is right
    return left == right


def _read_string_env(settings: Mapping[str, Any] | None) -> dict[str, str]:
    if settings is None:
        return {}
    env = settings.get("env")
    if not isinstance(env, Mapping):
        return {}
    return {key: value for key, value in env.items() if isinstance(value, str)}


def _unique_sources(sources: Sequence[SettingSource]) -> list[SettingSource]:
    result: list[SettingSource] = []
    for source in sources:
        if source not in result:
            result.append(source)
    return result


def _require_mandatory_sources(sources: Sequence[SettingSource]) -> None:
    for mandatory in ("flagSettings", "policySettings"):
        if mandatory not in sources:
            raise ValueError(f"{mandatory} must be present in the source order")


def _freeze_json(value: Any) -> Any:
    if isinstance(value, dict):
        return MappingProxyType(
            {key: _freeze_json(item) for key, item in value.items()}
        )
    if isinstance(value, list):
        return tuple(_freeze_json(item) for item in value)
    return value

