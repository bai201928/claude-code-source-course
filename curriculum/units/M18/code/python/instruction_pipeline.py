from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

InstructionSourceKind = Literal["managed", "user", "project", "local", "dynamic"]
InstructionTrust = Literal["trusted", "approved", "untrusted"]


@dataclass(frozen=True)
class InstructionSource:
    id: str
    kind: InstructionSourceKind
    file_path: str
    scope_root: str
    trust: InstructionTrust
    content: str
    path_prefixes: tuple[str, ...] = ()


@dataclass(frozen=True)
class InstructionCatalogSnapshot:
    revision: int
    sources: tuple[InstructionSource, ...]


@dataclass(frozen=True)
class ProjectedInstruction:
    id: str
    kind: InstructionSourceKind
    file_path: str
    content: str


@dataclass(frozen=True)
class InstructionProjectionReport:
    catalog_revision: int
    discovered_count: int
    selected_count: int
    deduplicated_count: int
    out_of_scope_count: int
    untrusted_count: int
    dynamic_count: int
    source_ids: tuple[str, ...]


@dataclass(frozen=True)
class InstructionSnapshot:
    catalog_revision: int
    target_path: str
    instructions: tuple[ProjectedInstruction, ...]
    report: InstructionProjectionReport


class InstructionInvariantError(ValueError):
    pass


class StaleInstructionRevisionError(RuntimeError):
    pass


class InstructionCatalog:
    def __init__(self, sources: tuple[InstructionSource, ...] = ()) -> None:
        self._revision = 0
        self._sources = _validate_sources(sources)

    @property
    def revision(self) -> int:
        return self._revision

    def snapshot(self) -> InstructionCatalogSnapshot:
        return InstructionCatalogSnapshot(self._revision, self._sources)

    def publish(
        self, expected_revision: int, sources: tuple[InstructionSource, ...]
    ) -> InstructionCatalogSnapshot:
        if expected_revision != self._revision:
            raise StaleInstructionRevisionError(
                f"stale instruction revision {expected_revision}; "
                f"current={self._revision}"
            )
        self._sources = _validate_sources(sources)
        self._revision += 1
        return self.snapshot()

    def assert_current(self, revision: int) -> None:
        if revision != self._revision:
            raise StaleInstructionRevisionError(
                f"stale instruction projection {revision}; "
                f"current={self._revision}"
            )


class InstructionPipeline:
    def project(
        self,
        catalog: InstructionCatalogSnapshot,
        target_path: str,
        dynamic_sources: tuple[InstructionSource, ...] = (),
    ) -> InstructionSnapshot:
        target = _normalize_absolute(target_path, "target path")
        if any(source.kind != "dynamic" for source in dynamic_sources):
            raise InstructionInvariantError(
                "request-only sources must use kind=dynamic"
            )
        candidates = _validate_sources((*catalog.sources, *dynamic_sources))
        selected: list[InstructionSource] = []
        untrusted = 0
        out_of_scope = 0
        for source in candidates:
            if source.trust == "untrusted":
                untrusted += 1
            elif not _applies_to(source, target):
                out_of_scope += 1
            else:
                selected.append(source)

        by_path: dict[str, InstructionSource] = {}
        for source in sorted(selected, key=_sort_key):
            by_path[_normalize_absolute(source.file_path, "instruction path")] = source
        ordered = tuple(sorted(by_path.values(), key=_sort_key))
        report = InstructionProjectionReport(
            catalog.revision,
            len(candidates),
            len(ordered),
            len(selected) - len(ordered),
            out_of_scope,
            untrusted,
            sum(source.kind == "dynamic" for source in ordered),
            tuple(source.id for source in ordered),
        )
        return InstructionSnapshot(
            catalog.revision,
            target,
            tuple(
                ProjectedInstruction(
                    source.id, source.kind, source.file_path, source.content
                )
                for source in ordered
            ),
            report,
        )


_KIND_ORDER = {"managed": 0, "user": 1, "project": 2, "local": 3, "dynamic": 4}


def _applies_to(source: InstructionSource, target: str) -> bool:
    root = Path(_normalize_absolute(source.scope_root, "scope root"))
    try:
        relative = Path(target).relative_to(root).as_posix().lower()
    except ValueError:
        return False
    if relative == ".":
        return not source.path_prefixes
    if not source.path_prefixes:
        return True
    return any(
        relative == prefix or relative.startswith(prefix + "/")
        for prefix in (_normalize_relative(item) for item in source.path_prefixes)
    )


def _sort_key(source: InstructionSource) -> tuple[int, int, str, str]:
    root = _normalize_absolute(source.scope_root, "scope root")
    return (
        _KIND_ORDER[source.kind],
        len(Path(root).parts),
        _normalize_absolute(source.file_path, "instruction path"),
        source.id,
    )


def _validate_sources(
    sources: tuple[InstructionSource, ...]
) -> tuple[InstructionSource, ...]:
    ids: set[str] = set()
    for source in sources:
        _require_text(source.id, "instruction id")
        _require_text(source.content, "instruction content")
        _normalize_absolute(source.file_path, "instruction path")
        _normalize_absolute(source.scope_root, "scope root")
        if source.id in ids:
            raise InstructionInvariantError(
                f"duplicate instruction id: {source.id}"
            )
        ids.add(source.id)
    return tuple(sources)


def _normalize_absolute(value: str, label: str) -> str:
    _require_text(value, label)
    path = Path(value)
    if not path.is_absolute():
        raise InstructionInvariantError(f"{label} must be absolute")
    return path.resolve().as_posix().lower()


def _normalize_relative(value: str) -> str:
    _require_text(value, "path prefix")
    normalized = value.replace("\\", "/").removeprefix("./").removesuffix("/").lower()
    if not normalized or normalized.startswith("../") or Path(normalized).is_absolute():
        raise InstructionInvariantError(
            "path prefix must stay relative to scope root"
        )
    return normalized


def _require_text(value: str, label: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise InstructionInvariantError(f"{label} must not be empty")
