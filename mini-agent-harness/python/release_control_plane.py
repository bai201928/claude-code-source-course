from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Mapping


@dataclass(frozen=True)
class ProtocolRange:
    minimum: int
    maximum: int


@dataclass(frozen=True)
class ReleaseManifest:
    release_id: str
    binary_version: str
    protocol: ProtocolRange
    readable_schema_versions: tuple[int, ...]
    write_schema_version: int
    policy_revision: int
    feature_revision: int


@dataclass(frozen=True)
class RolloutStage:
    name: str
    traffic_percent: int
    min_samples: int


@dataclass(frozen=True)
class SloPolicy:
    min_success_rate: float
    max_p95_latency_ms: float
    max_observer_drop_rate: float
    max_unknown_cost_rate: float


@dataclass(frozen=True)
class SliWindow:
    sample_count: int
    success_rate: float
    p95_latency_ms: float
    observer_drop_rate: float
    unknown_cost_rate: float


@dataclass(frozen=True)
class WorkerDependencies:
    transcript_store: bool
    work_queue: bool
    policy_source: bool
    quota_store: bool

    def ready(self) -> bool:
        return all(
            (self.transcript_store, self.work_queue, self.policy_source, self.quota_store)
        )


@dataclass(frozen=True)
class WorkerRegistration:
    worker_id: str
    release_id: str
    protocol_version: int
    readable_schema_versions: tuple[int, ...]
    write_schema_version: int
    policy_revision: int
    feature_revision: int
    dependencies: WorkerDependencies


WorkerStatus = Literal["ready", "draining", "drained", "unhealthy"]


@dataclass(frozen=True)
class WorkerReport:
    worker_id: str
    release_id: str
    status: WorkerStatus
    active_work_count: int
    protocol_version: int
    policy_revision: int
    feature_revision: int


@dataclass(frozen=True)
class ReleaseReport:
    revision: int
    active_release_id: str
    candidate_release_id: str | None
    previous_release_id: str | None
    rollout_state: Literal["idle", "prepared", "canary", "promoted", "rolled_back"]
    stage_name: str | None
    traffic_percent: int
    ready_active_workers: int
    ready_candidate_workers: int
    draining_workers: int
    active_work_count: int


class StaleReleaseRevisionError(RuntimeError):
    pass


class ReleaseCompatibilityError(ValueError):
    pass


class WorkerCompatibilityError(ValueError):
    pass


class ReleaseStateError(RuntimeError):
    pass


class SloViolationError(RuntimeError):
    pass


class WorkerStateError(RuntimeError):
    pass


@dataclass
class _WorkerState:
    registration: WorkerRegistration
    status: WorkerStatus
    active_work_count: int = 0


@dataclass
class _Rollout:
    stages: tuple[RolloutStage, ...]
    stage_index: int = -1
    state: Literal["prepared", "canary"] = "prepared"


class ReleaseController:
    """In-process reference state machine, not a deployment orchestrator."""

    def __init__(self, active: ReleaseManifest, slo: SloPolicy) -> None:
        _validate_manifest(active)
        _validate_slo(slo)
        self._revision = 1
        self._active = active
        self._candidate: ReleaseManifest | None = None
        self._previous: ReleaseManifest | None = None
        self._rollout: _Rollout | None = None
        self._terminal_state: Literal["idle", "promoted", "rolled_back"] = "idle"
        self._workers: dict[str, _WorkerState] = {}
        self._slo = slo

    def prepare(
        self,
        expected_revision: int,
        candidate: ReleaseManifest,
        stages: tuple[RolloutStage, ...],
    ) -> ReleaseReport:
        self._expect_revision(expected_revision)
        if self._candidate or self._rollout:
            raise ReleaseStateError("a rollout is already active")
        _validate_manifest(candidate)
        _validate_stages(stages)
        self._validate_release_compatibility(self._active, candidate)
        self._candidate = candidate
        self._rollout = _Rollout(stages)
        self._terminal_state = "idle"
        self._revision += 1
        return self.report()

    def register_worker(self, registration: WorkerRegistration) -> WorkerReport:
        if registration.worker_id in self._workers:
            raise WorkerStateError(f"duplicate worker id: {registration.worker_id}")
        manifest = self._manifest_for(registration.release_id)
        _validate_worker(registration, manifest)
        state = _WorkerState(
            registration,
            "ready" if registration.dependencies.ready() else "unhealthy",
        )
        self._workers[registration.worker_id] = state
        return _worker_report(state)

    def begin_canary(self, expected_revision: int) -> ReleaseReport:
        self._expect_revision(expected_revision)
        if not self._candidate or not self._rollout or self._rollout.state != "prepared":
            raise ReleaseStateError("no prepared rollout")
        if self._ready_workers(self._candidate.release_id) == 0:
            raise ReleaseStateError("candidate has no ready worker")
        if self._ready_workers(self._active.release_id) == 0:
            raise ReleaseStateError("active release has no ready worker")
        self._rollout.stage_index = 0
        self._rollout.state = "canary"
        self._revision += 1
        return self.report()

    def select_release(self, stable_bucket: int) -> str:
        if not isinstance(stable_bucket, int) or not 0 <= stable_bucket <= 99:
            raise ValueError("stable bucket must be an integer in [0, 99]")
        if not self._candidate or not self._rollout or self._rollout.state != "canary":
            return self._active.release_id
        stage = self._rollout.stages[self._rollout.stage_index]
        return (
            self._candidate.release_id
            if stable_bucket < stage.traffic_percent
            else self._active.release_id
        )

    def advance(self, expected_revision: int, window: SliWindow) -> ReleaseReport:
        self._expect_revision(expected_revision)
        if not self._candidate or not self._rollout or self._rollout.state != "canary":
            raise ReleaseStateError("no canary rollout")
        stage = self._rollout.stages[self._rollout.stage_index]
        _assert_slo(window, stage, self._slo)
        if self._rollout.stage_index < len(self._rollout.stages) - 1:
            self._rollout.stage_index += 1
        else:
            self._previous = self._active
            self._active = self._candidate
            self._candidate = None
            self._rollout = None
            self._terminal_state = "promoted"
        self._revision += 1
        return self.report()

    def rollback(self, expected_revision: int) -> ReleaseReport:
        self._expect_revision(expected_revision)
        if self._candidate:
            self._mark_release_draining(self._candidate.release_id)
            self._candidate = None
            self._rollout = None
            self._terminal_state = "rolled_back"
        elif self._previous:
            if self._active.write_schema_version not in self._previous.readable_schema_versions:
                raise ReleaseCompatibilityError(
                    "previous release cannot read active write schema"
                )
            rolled_release = self._active
            self._active = self._previous
            self._previous = rolled_release
            self._mark_release_draining(rolled_release.release_id)
            self._terminal_state = "rolled_back"
        else:
            raise ReleaseStateError("no candidate or previous release to roll back")
        self._revision += 1
        return self.report()

    def acquire_work(self, worker_id: str, selected_release_id: str) -> WorkerReport:
        state = self._worker(worker_id)
        if state.status != "ready":
            raise WorkerStateError(f"worker is not ready: {worker_id}")
        if state.registration.release_id != selected_release_id:
            raise WorkerStateError(
                f"worker release does not match selected release: {worker_id}"
            )
        state.active_work_count += 1
        return _worker_report(state)

    def complete_work(self, worker_id: str) -> WorkerReport:
        state = self._worker(worker_id)
        if state.active_work_count < 1:
            raise WorkerStateError(f"worker has no active work: {worker_id}")
        state.active_work_count -= 1
        if state.status == "draining" and state.active_work_count == 0:
            state.status = "drained"
        return _worker_report(state)

    def drain_worker(self, worker_id: str) -> WorkerReport:
        state = self._worker(worker_id)
        if state.status != "drained":
            state.status = "drained" if state.active_work_count == 0 else "draining"
        return _worker_report(state)

    def worker(self, worker_id: str) -> WorkerReport:
        return _worker_report(self._worker(worker_id))

    def report(self) -> ReleaseReport:
        stage = None
        if self._rollout and self._rollout.stage_index >= 0:
            stage = self._rollout.stages[self._rollout.stage_index]
        return ReleaseReport(
            self._revision,
            self._active.release_id,
            self._candidate.release_id if self._candidate else None,
            self._previous.release_id if self._previous else None,
            self._rollout.state if self._rollout else self._terminal_state,
            stage.name if stage else None,
            stage.traffic_percent if stage else 0,
            self._ready_workers(self._active.release_id),
            self._ready_workers(self._candidate.release_id) if self._candidate else 0,
            sum(worker.status == "draining" for worker in self._workers.values()),
            sum(worker.active_work_count for worker in self._workers.values()),
        )

    def _validate_release_compatibility(
        self, active: ReleaseManifest, candidate: ReleaseManifest
    ) -> None:
        if active.release_id == candidate.release_id:
            raise ReleaseCompatibilityError("release id must change")
        if not _ranges_overlap(active.protocol, candidate.protocol):
            raise ReleaseCompatibilityError("protocol ranges do not overlap")
        if active.write_schema_version not in candidate.readable_schema_versions:
            raise ReleaseCompatibilityError("candidate cannot read active write schema")
        if candidate.write_schema_version not in active.readable_schema_versions:
            raise ReleaseCompatibilityError(
                "rollback release cannot read candidate write schema"
            )
        if active.policy_revision != candidate.policy_revision:
            raise ReleaseCompatibilityError(
                "binary canary cannot split policy revision"
            )

    def _manifest_for(self, release_id: str) -> ReleaseManifest:
        for manifest in (self._active, self._candidate, self._previous):
            if manifest and manifest.release_id == release_id:
                return manifest
        raise WorkerCompatibilityError(f"unknown release: {release_id}")

    def _ready_workers(self, release_id: str) -> int:
        return sum(
            worker.registration.release_id == release_id and worker.status == "ready"
            for worker in self._workers.values()
        )

    def _mark_release_draining(self, release_id: str) -> None:
        for worker in self._workers.values():
            if worker.registration.release_id == release_id and worker.status == "ready":
                worker.status = "drained" if worker.active_work_count == 0 else "draining"

    def _worker(self, worker_id: str) -> _WorkerState:
        try:
            return self._workers[worker_id]
        except KeyError as error:
            raise WorkerStateError(f"unknown worker: {worker_id}") from error

    def _expect_revision(self, expected: int) -> None:
        if expected != self._revision:
            raise StaleReleaseRevisionError(
                f"stale release revision {expected}; current={self._revision}"
            )


def _validate_manifest(manifest: ReleaseManifest) -> None:
    _require_text(manifest.release_id, "release_id")
    _require_text(manifest.binary_version, "binary_version")
    _positive_int(manifest.protocol.minimum, "protocol.minimum")
    _positive_int(manifest.protocol.maximum, "protocol.maximum")
    if manifest.protocol.minimum > manifest.protocol.maximum:
        raise ValueError("protocol range is inverted")
    if not manifest.readable_schema_versions:
        raise ValueError("at least one readable schema is required")
    for version in manifest.readable_schema_versions:
        _positive_int(version, "readable schema")
    _positive_int(manifest.write_schema_version, "write_schema_version")
    _positive_int(manifest.policy_revision, "policy_revision")
    _positive_int(manifest.feature_revision, "feature_revision")
    if manifest.write_schema_version not in manifest.readable_schema_versions:
        raise ValueError("release must read its own write schema")


def _validate_worker(worker: WorkerRegistration, manifest: ReleaseManifest) -> None:
    _require_text(worker.worker_id, "worker_id")
    if not manifest.protocol.minimum <= worker.protocol_version <= manifest.protocol.maximum:
        raise WorkerCompatibilityError("worker protocol is outside release range")
    if worker.write_schema_version != manifest.write_schema_version:
        raise WorkerCompatibilityError("worker write schema does not match manifest")
    if not all(
        version in worker.readable_schema_versions
        for version in manifest.readable_schema_versions
    ):
        raise WorkerCompatibilityError("worker cannot read every manifest schema")
    if worker.policy_revision != manifest.policy_revision:
        raise WorkerCompatibilityError("worker policy revision does not match manifest")
    if worker.feature_revision != manifest.feature_revision:
        raise WorkerCompatibilityError("worker feature revision does not match manifest")


def _validate_stages(stages: tuple[RolloutStage, ...]) -> None:
    if not stages:
        raise ValueError("rollout needs at least one stage")
    previous = 0
    for stage in stages:
        _require_text(stage.name, "stage.name")
        if not previous < stage.traffic_percent <= 100:
            raise ValueError("traffic stages must increase to at most 100")
        _positive_int(stage.min_samples, "stage.min_samples")
        previous = stage.traffic_percent
    if previous != 100:
        raise ValueError("last rollout stage must be 100 percent")


def _validate_slo(slo: SloPolicy) -> None:
    _ratio(slo.min_success_rate, "min_success_rate")
    _ratio(slo.max_observer_drop_rate, "max_observer_drop_rate")
    _ratio(slo.max_unknown_cost_rate, "max_unknown_cost_rate")
    if slo.max_p95_latency_ms <= 0:
        raise ValueError("max_p95_latency_ms must be positive")


def _assert_slo(window: SliWindow, stage: RolloutStage, slo: SloPolicy) -> None:
    if (
        window.sample_count < stage.min_samples
        or window.success_rate < slo.min_success_rate
        or window.p95_latency_ms > slo.max_p95_latency_ms
        or window.observer_drop_rate > slo.max_observer_drop_rate
        or window.unknown_cost_rate > slo.max_unknown_cost_rate
    ):
        raise SloViolationError(f"SLO rejected rollout stage: {stage.name}")


def _ranges_overlap(left: ProtocolRange, right: ProtocolRange) -> bool:
    return left.minimum <= right.maximum and right.minimum <= left.maximum


def _worker_report(state: _WorkerState) -> WorkerReport:
    return WorkerReport(
        state.registration.worker_id,
        state.registration.release_id,
        state.status,
        state.active_work_count,
        state.registration.protocol_version,
        state.registration.policy_revision,
        state.registration.feature_revision,
    )


def _ratio(value: float, name: str) -> None:
    if not 0 <= value <= 1:
        raise ValueError(f"{name} must be in [0, 1]")


def _positive_int(value: int, name: str) -> None:
    if not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be a positive integer")


def _require_text(value: str, name: str) -> None:
    if not value.strip():
        raise ValueError(f"{name} must not be empty")
