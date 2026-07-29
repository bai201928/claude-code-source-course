from __future__ import annotations

import asyncio
from dataclasses import dataclass
from math import isfinite
from time import monotonic
from typing import Awaitable, Callable, Literal, Mapping

CleanupTier = Literal["critical", "resource", "best-effort"]
LifecycleState = Literal["running", "stopping", "stopped"]
CleanupStatus = Literal["completed", "failed", "timed-out", "skipped"]
CLEANUP_TIERS: tuple[CleanupTier, ...] = (
    "critical",
    "resource",
    "best-effort",
)


class CancellationToken:
    def __init__(self) -> None:
        self._event = asyncio.Event()
        self.reason: str | None = None

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def cancel(self, reason: str) -> None:
        if self._event.is_set():
            return
        self.reason = reason
        self._event.set()

    async def wait(self) -> None:
        await self._event.wait()


@dataclass(frozen=True)
class ShutdownRequest:
    reason: str
    exit_code: int
    overall_budget_ms: float
    tier_budget_ms: Mapping[CleanupTier, float]


@dataclass(frozen=True)
class CleanupResult:
    name: str
    tier: CleanupTier
    status: CleanupStatus
    duration_ms: float
    error: str | None = None


@dataclass(frozen=True)
class ShutdownReport:
    reason: str
    exit_code: int
    state: Literal["stopped"]
    recovery_hint: str | None
    deadline_exceeded: bool
    results: tuple[CleanupResult, ...]
    trace: tuple[str, ...]


CleanupHandler = Callable[[CancellationToken], Awaitable[None]]


@dataclass(frozen=True)
class _Registration:
    name: str
    tier: CleanupTier
    handler: CleanupHandler


class LifecycleCoordinator:
    def __init__(
        self,
        *,
        prepare: Callable[[ShutdownRequest], str | None] | None = None,
        on_failsafe: Callable[[ShutdownRequest], None] | None = None,
        now: Callable[[], float] = monotonic,
    ) -> None:
        self._state: LifecycleState = "running"
        self._registrations: dict[str, _Registration] = {}
        self._shutdown_task: asyncio.Task[ShutdownReport] | None = None
        self._prepare = prepare
        self._on_failsafe = on_failsafe
        self._now = now

    @property
    def state(self) -> LifecycleState:
        return self._state

    def register(
        self, name: str, tier: CleanupTier, handler: CleanupHandler
    ) -> Callable[[], None]:
        _require_non_empty(name, "cleanup name")
        if self._state != "running":
            raise ValueError(
                f"cannot register cleanup while lifecycle is {self._state}"
            )
        if name in self._registrations:
            raise ValueError(f"cleanup already registered: {name}")
        self._registrations[name] = _Registration(name, tier, handler)
        active = True

        def unregister() -> None:
            nonlocal active
            if not active:
                return
            active = False
            self._registrations.pop(name, None)

        return unregister

    def shutdown(self, request: ShutdownRequest) -> asyncio.Task[ShutdownReport]:
        if self._shutdown_task is not None:
            return self._shutdown_task
        _validate_request(request)
        self._state = "stopping"
        self._shutdown_task = asyncio.create_task(self._run_shutdown(request))
        return self._shutdown_task

    async def _run_shutdown(self, request: ShutdownRequest) -> ShutdownReport:
        started_at = self._now()
        trace = [f"shutdown:start:{request.reason}:{request.exit_code}"]
        recovery_hint: str | None = None
        try:
            recovery_hint = self._prepare(request) if self._prepare else None
            trace.append("prepare:completed")
        except Exception as error:
            trace.append(f"prepare:failed:{error}")

        snapshot = tuple(self._registrations.values())
        results: list[CleanupResult] = []
        deadline_exceeded = False
        processed_tier_count = 0

        for tier in CLEANUP_TIERS:
            elapsed_ms = max(0.0, (self._now() - started_at) * 1000)
            remaining_ms = request.overall_budget_ms - elapsed_ms
            if remaining_ms <= 0:
                deadline_exceeded = True
                break
            entries = tuple(item for item in snapshot if item.tier == tier)
            budget_ms = min(request.tier_budget_ms[tier], remaining_ms)
            trace.append(f"tier:start:{tier}:{budget_ms}")
            tier_results, timed_out = await _run_tier(
                entries, tier, budget_ms, self._now
            )
            results.extend(tier_results)
            trace.append(
                f"tier:end:{tier}:{'timed-out' if timed_out else 'settled'}"
            )
            processed_tier_count += 1
            if timed_out and budget_ms == remaining_ms:
                deadline_exceeded = True
                break

        if deadline_exceeded:
            for tier in CLEANUP_TIERS[processed_tier_count:]:
                results.extend(
                    CleanupResult(item.name, tier, "skipped", 0.0)
                    for item in snapshot
                    if item.tier == tier
                )
            trace.append("failsafe:deadline-exceeded")
            try:
                if self._on_failsafe:
                    self._on_failsafe(request)
            except Exception as error:
                trace.append(f"failsafe:callback-failed:{error}")

        self._state = "stopped"
        trace.append("shutdown:stopped")
        return ShutdownReport(
            request.reason,
            request.exit_code,
            "stopped",
            recovery_hint,
            deadline_exceeded,
            tuple(results),
            tuple(trace),
        )


async def _run_tier(
    entries: tuple[_Registration, ...],
    tier: CleanupTier,
    budget_ms: float,
    now: Callable[[], float],
) -> tuple[tuple[CleanupResult, ...], bool]:
    if not entries:
        return (), False

    token = CancellationToken()
    started = [now() for _ in entries]
    tasks = [asyncio.create_task(item.handler(token)) for item in entries]
    done, pending = await asyncio.wait(tasks, timeout=budget_ms / 1000)
    timed_out = bool(pending)
    if timed_out:
        token.cancel(f"cleanup-tier-timeout:{tier}")

    results: list[CleanupResult] = []
    for index, (entry, task) in enumerate(zip(entries, tasks, strict=True)):
        duration_ms = max(0.0, (now() - started[index]) * 1000)
        if task in pending:
            results.append(
                CleanupResult(entry.name, tier, "timed-out", duration_ms)
            )
            task.add_done_callback(_consume_task_result)
        else:
            try:
                task.result()
                results.append(
                    CleanupResult(entry.name, tier, "completed", duration_ms)
                )
            except Exception as error:
                results.append(
                    CleanupResult(
                        entry.name, tier, "failed", duration_ms, str(error)
                    )
                )
    return tuple(results), timed_out


def _consume_task_result(task: asyncio.Task[None]) -> None:
    try:
        task.result()
    except (Exception, asyncio.CancelledError):
        pass


def _validate_request(request: ShutdownRequest) -> None:
    _require_non_empty(request.reason, "shutdown reason")
    if not isinstance(request.exit_code, int):
        raise ValueError("exit_code must be an integer")
    _require_positive(request.overall_budget_ms, "overall_budget_ms")
    for tier in CLEANUP_TIERS:
        if tier not in request.tier_budget_ms:
            raise ValueError(f"tier_budget_ms.{tier} is required")
        _require_positive(request.tier_budget_ms[tier], f"tier_budget_ms.{tier}")


def _require_positive(value: float, name: str) -> None:
    if not isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be positive")


def _require_non_empty(value: str, name: str) -> None:
    if not value.strip():
        raise ValueError(f"{name} must not be empty")
