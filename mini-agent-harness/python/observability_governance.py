from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Literal, Mapping, Protocol


AttemptRoute = Literal["primary", "retry", "fallback"]


@dataclass(frozen=True)
class AttemptIdentity:
    run_id: str
    request_id: str
    attempt_id: str
    route: AttemptRoute


@dataclass(frozen=True)
class TelemetryEvent:
    kind: Literal["attempt_started", "attempt_finished", "tool_finished"]
    event_id: str
    occurred_at_ms: int
    run_id: str
    request_id: str | None = None
    attempt_id: str | None = None
    tool_call_id: str | None = None
    route: AttemptRoute | None = None
    outcome: Literal["succeeded", "failed", "cancelled", "denied"] | None = None
    duration_ms: int | None = None
    ttft_ms: int | None = None
    retry_ordinal: int | None = None


class OpenTelemetryPort(Protocol):
    def export(self, event: TelemetryEvent) -> None | Awaitable[None]: ...


class TelemetryRecorder:
    """Observer failures are counted and never cross into the run outcome."""

    def __init__(self, port: OpenTelemetryPort) -> None:
        self._port = port
        self._observer_failure_count = 0

    async def record(self, event: TelemetryEvent) -> bool:
        try:
            result = self._port.export(event)
            if isinstance(result, Awaitable):
                await result
            return True
        except Exception:
            self._observer_failure_count += 1
            return False

    def report(self) -> Mapping[str, int]:
        return {"observer_failure_count": self._observer_failure_count}


@dataclass(frozen=True)
class UsageSnapshot:
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0


@dataclass(frozen=True)
class TokenPrice:
    input_usd_per_million: float
    output_usd_per_million: float
    cache_read_usd_per_million: float
    cache_creation_usd_per_million: float


@dataclass(frozen=True)
class UsageCostCommand:
    event_id: str
    identity: AttemptIdentity
    model: str
    price_version: str
    captured_at_ms: int
    cumulative: UsageSnapshot
    price: TokenPrice | None = None
    ttft_ms: int | None = None


@dataclass(frozen=True)
class UsageCostEntry:
    event_id: str
    identity: AttemptIdentity
    model: str
    price_version: str
    captured_at_ms: int
    cumulative: UsageSnapshot
    delta: UsageSnapshot
    cost_status: Literal["known", "unknown"]
    cost_usd: float | None
    ttft_status: Literal["observed", "unknown"]
    ttft_ms: int | None


class EventCollisionError(ValueError):
    pass


class NonMonotonicUsageError(ValueError):
    pass


class UsageCostLedger:
    def __init__(self) -> None:
        self._entries: list[UsageCostEntry] = []
        self._events: dict[str, tuple[UsageCostCommand, UsageCostEntry]] = {}
        self._last_by_attempt: dict[tuple[str, str, str], UsageSnapshot] = {}

    def record(self, command: UsageCostCommand) -> UsageCostEntry:
        _validate_usage_command(command)
        existing = self._events.get(command.event_id)
        if existing is not None:
            if existing[0] != command:
                raise EventCollisionError(f"usage event id collision: {command.event_id}")
            return existing[1]

        key = (
            command.identity.run_id,
            command.identity.request_id,
            command.identity.attempt_id,
        )
        previous = self._last_by_attempt.get(key, UsageSnapshot(0, 0, 0, 0))
        delta = _subtract_usage(command.cumulative, previous)
        cost = _calculate_cost(delta, command.price) if command.price else None
        entry = UsageCostEntry(
            command.event_id,
            command.identity,
            command.model,
            command.price_version,
            command.captured_at_ms,
            command.cumulative,
            delta,
            "known" if command.price else "unknown",
            cost,
            "observed" if command.ttft_ms is not None else "unknown",
            command.ttft_ms,
        )
        self._last_by_attempt[key] = command.cumulative
        self._entries.append(entry)
        self._events[command.event_id] = (command, entry)
        return entry

    def entries(self) -> tuple[UsageCostEntry, ...]:
        return tuple(self._entries)

    def report(self) -> Mapping[str, int | float]:
        return {
            "entry_count": len(self._entries),
            "known_cost_usd": sum(entry.cost_usd or 0 for entry in self._entries),
            "unknown_cost_entry_count": sum(
                entry.cost_status == "unknown" for entry in self._entries
            ),
            "unknown_ttft_entry_count": sum(
                entry.ttft_status == "unknown" for entry in self._entries
            ),
        }


EvaluationName = Literal["correctness", "grounding", "safety", "efficiency"]


@dataclass(frozen=True)
class EvaluationDimension:
    name: EvaluationName
    score: float
    passed: bool


@dataclass(frozen=True)
class EvaluationRecord:
    event_id: str
    run_id: str
    evaluation_id: str
    rubric_id: str
    rubric_version: int
    evaluator_version: str
    outcome: Literal["passed", "failed", "inconclusive"]
    dimensions: tuple[EvaluationDimension, ...]
    recorded_at_ms: int


class EvaluationLedger:
    def __init__(self) -> None:
        self._records: list[EvaluationRecord] = []
        self._events: dict[str, EvaluationRecord] = {}

    def record(self, record: EvaluationRecord) -> EvaluationRecord:
        _require_text(record.event_id, "event_id")
        _require_text(record.rubric_id, "rubric_id")
        if record.rubric_version < 1:
            raise ValueError("rubric_version must be positive")
        existing = self._events.get(record.event_id)
        if existing is not None:
            if existing != record:
                raise EventCollisionError(
                    f"evaluation event id collision: {record.event_id}"
                )
            return existing
        self._events[record.event_id] = record
        self._records.append(record)
        return record

    def records(self) -> tuple[EvaluationRecord, ...]:
        return tuple(self._records)


@dataclass(frozen=True)
class TenantLimit:
    max_tokens_per_window: int
    max_cost_usd_per_window: float
    max_concurrency: int
    max_queue_size: int


@dataclass(frozen=True)
class ReservationRequest:
    tenant_id: str
    reservation_id: str
    estimated_tokens: int
    estimated_cost_usd: float
    requested_at_ms: int


@dataclass(frozen=True)
class TenantReservation:
    tenant_id: str
    reservation_id: str
    estimated_tokens: int
    estimated_cost_usd: float
    requested_at_ms: int
    admitted_at_ms: int


@dataclass(frozen=True)
class TenantGovernanceReport:
    tenant_id: str
    active_concurrency: int
    queue_depth: int
    reserved_tokens: int
    reserved_cost_usd: float
    consumed_tokens: int
    consumed_cost_usd: float


class UnknownTenantError(KeyError):
    pass


class TenantQueueFullError(RuntimeError):
    pass


class ReservationTooLargeError(ValueError):
    pass


class ReservationStateError(RuntimeError):
    pass


class ReservationCancelledError(asyncio.CancelledError):
    pass


@dataclass
class _QueuedReservation:
    request: ReservationRequest
    future: asyncio.Future[TenantReservation]


@dataclass
class _TenantState:
    limit: TenantLimit
    active: dict[str, TenantReservation]
    queue: list[_QueuedReservation]
    known_ids: set[str]
    consumed_tokens: int = 0
    consumed_cost_usd: float = 0.0


class TenantGovernor:
    """In-process reference governor; distributed CAS and fairness are deferred."""

    def __init__(self, limits: Mapping[str, TenantLimit], now=lambda: 0) -> None:
        self._now = now
        self._states: dict[str, _TenantState] = {}
        for tenant_id, limit in limits.items():
            _validate_limit(limit)
            self._states[tenant_id] = _TenantState(limit, {}, [], set())

    async def reserve(self, request: ReservationRequest) -> TenantReservation:
        _validate_reservation(request)
        state = self._state(request.tenant_id)
        if request.reservation_id in state.known_ids:
            raise ReservationStateError(
                f"duplicate reservation id: {request.reservation_id}"
            )
        if (
            request.estimated_tokens > state.limit.max_tokens_per_window
            or request.estimated_cost_usd > state.limit.max_cost_usd_per_window
        ):
            raise ReservationTooLargeError(
                f"reservation exceeds tenant limit: {request.reservation_id}"
            )
        state.known_ids.add(request.reservation_id)
        if _can_admit(state, request):
            return self._admit(state, request)
        if len(state.queue) >= state.limit.max_queue_size:
            state.known_ids.remove(request.reservation_id)
            raise TenantQueueFullError(f"tenant queue full: {request.tenant_id}")
        future = asyncio.get_running_loop().create_future()
        state.queue.append(_QueuedReservation(request, future))
        return await future

    def complete(
        self,
        tenant_id: str,
        reservation_id: str,
        actual_tokens: int,
        actual_cost_usd: float,
    ) -> TenantGovernanceReport:
        _validate_amount(actual_tokens, "actual_tokens", integer=True)
        _validate_amount(actual_cost_usd, "actual_cost_usd")
        state = self._state(tenant_id)
        if state.active.pop(reservation_id, None) is None:
            raise ReservationStateError(
                f"reservation is not active: {reservation_id}"
            )
        state.consumed_tokens += actual_tokens
        state.consumed_cost_usd += actual_cost_usd
        self._promote(state)
        return _report(tenant_id, state)

    def cancel(self, tenant_id: str, reservation_id: str) -> TenantGovernanceReport:
        state = self._state(tenant_id)
        if state.active.pop(reservation_id, None) is None:
            index = next(
                (
                    index
                    for index, item in enumerate(state.queue)
                    if item.request.reservation_id == reservation_id
                ),
                -1,
            )
            if index < 0:
                raise ReservationStateError(
                    f"reservation is not active or queued: {reservation_id}"
                )
            queued = state.queue.pop(index)
            queued.future.set_exception(
                ReservationCancelledError(f"reservation cancelled: {reservation_id}")
            )
        self._promote(state)
        return _report(tenant_id, state)

    def reset_budget_window(self, tenant_id: str) -> TenantGovernanceReport:
        state = self._state(tenant_id)
        state.consumed_tokens = 0
        state.consumed_cost_usd = 0
        self._promote(state)
        return _report(tenant_id, state)

    def report(self, tenant_id: str) -> TenantGovernanceReport:
        return _report(tenant_id, self._state(tenant_id))

    def _state(self, tenant_id: str) -> _TenantState:
        try:
            return self._states[tenant_id]
        except KeyError as error:
            raise UnknownTenantError(f"unknown tenant: {tenant_id}") from error

    def _admit(
        self, state: _TenantState, request: ReservationRequest
    ) -> TenantReservation:
        reservation = TenantReservation(
            request.tenant_id,
            request.reservation_id,
            request.estimated_tokens,
            request.estimated_cost_usd,
            request.requested_at_ms,
            self._now(),
        )
        state.active[request.reservation_id] = reservation
        return reservation

    def _promote(self, state: _TenantState) -> None:
        while state.queue and _can_admit(state, state.queue[0].request):
            queued = state.queue.pop(0)
            queued.future.set_result(self._admit(state, queued.request))


def _subtract_usage(current: UsageSnapshot, previous: UsageSnapshot) -> UsageSnapshot:
    values = (
        current.input_tokens - previous.input_tokens,
        current.output_tokens - previous.output_tokens,
        current.cache_read_tokens - previous.cache_read_tokens,
        current.cache_creation_tokens - previous.cache_creation_tokens,
    )
    if any(value < 0 for value in values):
        raise NonMonotonicUsageError("cumulative usage decreased")
    return UsageSnapshot(*values)


def _calculate_cost(usage: UsageSnapshot, price: TokenPrice) -> float:
    return (
        usage.input_tokens * price.input_usd_per_million
        + usage.output_tokens * price.output_usd_per_million
        + usage.cache_read_tokens * price.cache_read_usd_per_million
        + usage.cache_creation_tokens * price.cache_creation_usd_per_million
    ) / 1_000_000


def _validate_usage_command(command: UsageCostCommand) -> None:
    _require_text(command.event_id, "event_id")
    _require_text(command.identity.run_id, "run_id")
    _require_text(command.identity.request_id, "request_id")
    _require_text(command.identity.attempt_id, "attempt_id")
    _require_text(command.model, "model")
    _require_text(command.price_version, "price_version")
    for name, value in vars(command.cumulative).items():
        _validate_amount(value, name, integer=True)
    if command.ttft_ms is not None:
        _validate_amount(command.ttft_ms, "ttft_ms", integer=True)


def _validate_limit(limit: TenantLimit) -> None:
    _validate_amount(limit.max_tokens_per_window, "max_tokens_per_window", integer=True)
    _validate_amount(limit.max_cost_usd_per_window, "max_cost_usd_per_window")
    if limit.max_concurrency < 1:
        raise ValueError("max_concurrency must be positive")
    if limit.max_queue_size < 0:
        raise ValueError("max_queue_size must be non-negative")


def _validate_reservation(request: ReservationRequest) -> None:
    _require_text(request.tenant_id, "tenant_id")
    _require_text(request.reservation_id, "reservation_id")
    _validate_amount(request.estimated_tokens, "estimated_tokens", integer=True)
    _validate_amount(request.estimated_cost_usd, "estimated_cost_usd")


def _validate_amount(value: int | float, name: str, integer: bool = False) -> None:
    if value < 0 or (integer and not isinstance(value, int)):
        raise ValueError(f"{name} must be a non-negative {'integer' if integer else 'number'}")


def _require_text(value: str, name: str) -> None:
    if not value.strip():
        raise ValueError(f"{name} must not be empty")


def _can_admit(state: _TenantState, request: ReservationRequest) -> bool:
    reserved_tokens = sum(item.estimated_tokens for item in state.active.values())
    reserved_cost = sum(item.estimated_cost_usd for item in state.active.values())
    return (
        len(state.active) < state.limit.max_concurrency
        and state.consumed_tokens + reserved_tokens + request.estimated_tokens
        <= state.limit.max_tokens_per_window
        and state.consumed_cost_usd + reserved_cost + request.estimated_cost_usd
        <= state.limit.max_cost_usd_per_window
    )


def _report(tenant_id: str, state: _TenantState) -> TenantGovernanceReport:
    return TenantGovernanceReport(
        tenant_id,
        len(state.active),
        len(state.queue),
        sum(item.estimated_tokens for item in state.active.values()),
        sum(item.estimated_cost_usd for item in state.active.values()),
        state.consumed_tokens,
        state.consumed_cost_usd,
    )
