from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal, Protocol
import re

ExtensionComponentKind = Literal["skill", "command", "tool", "agent"]
ExtensionTrust = Literal["local-trusted", "signed", "untrusted"]
TraceAction = Literal["publish", "reject-conflict", "acquire", "release"]


@dataclass(frozen=True)
class ExtensionSourceIdentity:
    marketplace: str
    locator: str
    plugin: str
    version: str


@dataclass(frozen=True)
class ExtensionComponent:
    kind: ExtensionComponentKind
    name: str
    description: str
    priority: float = 50
    deferred: bool = False


@dataclass(frozen=True)
class ExtensionBundle:
    namespace: str
    source: ExtensionSourceIdentity
    trust: ExtensionTrust
    components: tuple[ExtensionComponent, ...]
    signature: str | None = None


@dataclass(frozen=True)
class RegisteredExtension:
    qualified_name: str
    bundle_key: str
    namespace: str
    source: ExtensionSourceIdentity
    component: ExtensionComponent


@dataclass(frozen=True)
class ExtensionSnapshot:
    revision: int
    entries: tuple[RegisteredExtension, ...]


@dataclass(frozen=True)
class ExtensionConflict:
    qualified_name: str
    bundle_keys: tuple[str, ...]


@dataclass(frozen=True)
class ExtensionPublication:
    ok: bool
    revision: int
    snapshot: ExtensionSnapshot | None = None
    conflicts: tuple[ExtensionConflict, ...] = ()


@dataclass(frozen=True)
class ExtensionTrace:
    action: TraceAction
    revision: int
    bundle_count: int
    conflict_count: int


class ExtensionTrustPolicy(Protocol):
    def assert_allowed(self, bundle: ExtensionBundle) -> None: ...


class SignatureTrustPolicy:
    def assert_allowed(self, bundle: ExtensionBundle) -> None:
        if bundle.trust == "untrusted":
            raise ValueError("untrusted extension bundle")
        if bundle.trust == "signed" and not (bundle.signature or "").strip():
            raise ValueError("signed extension bundle requires signature evidence")


class StaleExtensionRevisionError(RuntimeError):
    pass


class ExtensionLease:
    def __init__(
        self,
        bundle_key: str,
        qualified_name: str,
        acquired_revision: int,
        release_callback: Callable[[], None],
    ) -> None:
        self.bundle_key = bundle_key
        self.qualified_name = qualified_name
        self.acquired_revision = acquired_revision
        self._release_callback = release_callback
        self._released = False

    @property
    def valid(self) -> bool:
        return not self._released

    def release(self) -> None:
        if self._released:
            return
        self._released = True
        self._release_callback()


class ExtensionRegistry:
    def __init__(self, trust_policy: ExtensionTrustPolicy | None = None) -> None:
        self._revision = 0
        self._entries: tuple[RegisteredExtension, ...] = ()
        self._active_bundle_keys: frozenset[str] = frozenset()
        self._trust_policy = trust_policy or SignatureTrustPolicy()
        self._traces: list[ExtensionTrace] = []
        self._lease_sequence = 0
        self._leases: set[int] = set()

    def snapshot(self) -> ExtensionSnapshot:
        return ExtensionSnapshot(self._revision, self._entries)

    def publish(
        self, expected_revision: int, bundles: tuple[ExtensionBundle, ...]
    ) -> ExtensionPublication:
        if expected_revision != self._revision:
            raise StaleExtensionRevisionError(
                f"stale extension revision {expected_revision}; current={self._revision}"
            )
        for bundle in bundles:
            _validate_bundle(bundle, self._trust_policy)
        candidates = tuple(
            RegisteredExtension(
                f"{bundle.namespace}:{component.name}",
                _source_key(bundle.source),
                bundle.namespace,
                bundle.source,
                component,
            )
            for bundle in bundles
            for component in bundle.components
        )
        conflicts = _find_conflicts(candidates)
        if conflicts:
            self._record("reject-conflict", len(bundles), len(conflicts))
            return ExtensionPublication(False, self._revision, conflicts=conflicts)

        self._entries = tuple(
            sorted(candidates, key=lambda item: (item.qualified_name, item.bundle_key))
        )
        self._active_bundle_keys = frozenset(
            _source_key(bundle.source) for bundle in bundles
        )
        self._revision += 1
        self._record("publish", len(bundles), 0)
        snapshot = self.snapshot()
        return ExtensionPublication(True, self._revision, snapshot=snapshot)

    def acquire(
        self, snapshot: ExtensionSnapshot, qualified_name: str
    ) -> ExtensionLease:
        entry = next(
            (
                candidate
                for candidate in snapshot.entries
                if candidate.qualified_name == qualified_name
            ),
            None,
        )
        if entry is None:
            raise ValueError(f"extension is not visible in snapshot: {qualified_name}")
        if entry.bundle_key not in self._active_bundle_keys:
            raise ValueError(f"extension version is no longer active: {qualified_name}")
        self._lease_sequence += 1
        lease_id = self._lease_sequence
        self._leases.add(lease_id)
        self._record("acquire", len(self._active_bundle_keys), 0)

        def release() -> None:
            self._leases.discard(lease_id)
            self._record("release", len(self._active_bundle_keys), 0)

        return ExtensionLease(
            entry.bundle_key, qualified_name, snapshot.revision, release
        )

    def traces(self) -> tuple[ExtensionTrace, ...]:
        return tuple(self._traces)

    def capability_definitions(
        self, snapshot: ExtensionSnapshot
    ) -> tuple[tuple[str, str, float, bool], ...]:
        return tuple(
            (
                entry.qualified_name,
                entry.component.description,
                entry.component.priority,
                entry.component.deferred,
            )
            for entry in snapshot.entries
        )

    def _record(
        self, action: TraceAction, bundle_count: int, conflict_count: int
    ) -> None:
        self._traces.append(
            ExtensionTrace(
                action, self._revision, bundle_count, conflict_count
            )
        )


def _validate_bundle(
    bundle: ExtensionBundle, trust_policy: ExtensionTrustPolicy
) -> None:
    _require_identifier(bundle.namespace, "extension namespace")
    for label, value in (
        ("marketplace", bundle.source.marketplace),
        ("locator", bundle.source.locator),
        ("plugin", bundle.source.plugin),
        ("version", bundle.source.version),
    ):
        _require_text(value, f"source {label}")
    if not bundle.components:
        raise ValueError("extension bundle must contain components")
    trust_policy.assert_allowed(bundle)
    names: set[str] = set()
    for component in bundle.components:
        _require_identifier(component.name, "component name")
        _require_text(component.description, "component description")
        if component.name in names:
            raise ValueError(f"duplicate component in bundle: {component.name}")
        names.add(component.name)


def _find_conflicts(
    entries: tuple[RegisteredExtension, ...]
) -> tuple[ExtensionConflict, ...]:
    owners: dict[str, set[str]] = {}
    for entry in entries:
        owners.setdefault(entry.qualified_name, set()).add(entry.bundle_key)
    return tuple(
        ExtensionConflict(name, tuple(sorted(keys)))
        for name, keys in sorted(owners.items())
        if len(keys) > 1
    )


def _source_key(source: ExtensionSourceIdentity) -> str:
    return (
        f"{source.marketplace}::{source.locator}::"
        f"{source.plugin}::{source.version}"
    )


def _require_identifier(value: str, label: str) -> None:
    _require_text(value, label)
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]*", value) is None:
        raise ValueError(f"{label} must use the portable ASCII identifier form")


def _require_text(value: str, label: str) -> None:
    if not value.strip():
        raise ValueError(f"{label} must not be empty")
