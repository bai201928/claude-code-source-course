from __future__ import annotations

import asyncio
import math
import time
import uuid
from copy import deepcopy
from dataclasses import dataclass, replace
from typing import Awaitable, Callable, Literal, Protocol


class Clock(Protocol):
    def now(self) -> int: ...


class SystemClock:
    def now(self) -> int:
        return int(time.time() * 1000)


@dataclass(frozen=True)
class ClaimLease:
    owner_id: str
    token: str
    generation: int
    heartbeat_at: int
    expires_at: int


@dataclass(frozen=True)
class WorkItem:
    id: str
    subject: str
    blocker_ids: tuple[str, ...]
    status: Literal["pending", "in_progress", "completed"]
    revision: int
    lease: ClaimLease | None = None


@dataclass(frozen=True)
class ClaimResult:
    ok: bool
    reason: Literal[
        "not_found", "blocked", "claimed", "completed", "stale_revision"
    ] | None = None
    item: WorkItem | None = None
    lease: ClaimLease | None = None
    blocker_ids: tuple[str, ...] = ()


class WorkItemStore:
    def __init__(
        self,
        *,
        clock: Clock | None = None,
        new_token: Callable[[], str] | None = None,
    ) -> None:
        self._clock = clock or SystemClock()
        self._new_token = new_token or (lambda: str(uuid.uuid4()))
        self._items: dict[str, WorkItem] = {}

    def create(
        self, item_id: str, subject: str, blocker_ids: tuple[str, ...] = ()
    ) -> WorkItem:
        _require_text(item_id, "work item id")
        _require_text(subject, "work item subject")
        if item_id in self._items:
            raise ValueError(f"duplicate work item: {item_id}")
        if len(set(blocker_ids)) != len(blocker_ids):
            raise ValueError(f"duplicate blocker on work item: {item_id}")
        if item_id in blocker_ids:
            raise ValueError("work item cannot block itself")
        item = WorkItem(item_id, subject, tuple(blocker_ids), "pending", 1)
        self._items[item_id] = item
        return item

    def get(self, item_id: str) -> WorkItem | None:
        return self._items.get(item_id)

    def list(self) -> tuple[WorkItem, ...]:
        return tuple(self._items.values())

    def claim(
        self,
        item_id: str,
        owner_id: str,
        ttl_ms: int,
        expected_revision: int | None = None,
    ) -> ClaimResult:
        _require_text(owner_id, "claim owner")
        _require_positive(ttl_ms, "claim ttl")
        item = self._items.get(item_id)
        if item is None:
            return ClaimResult(False, "not_found")
        item = self._expire_if_needed(item)
        if expected_revision is not None and item.revision != expected_revision:
            return ClaimResult(False, "stale_revision", item)
        if item.status == "completed":
            return ClaimResult(False, "completed", item)
        blockers = tuple(
            blocker_id
            for blocker_id in item.blocker_ids
            if (blocker := self._items.get(blocker_id)) is not None
            and blocker.status != "completed"
        )
        if blockers:
            return ClaimResult(False, "blocked", item, blocker_ids=blockers)
        if item.lease is not None and item.lease.owner_id != owner_id:
            return ClaimResult(False, "claimed", item)
        now = self._clock.now()
        lease = ClaimLease(
            owner_id,
            item.lease.token if item.lease else self._new_token(),
            item.lease.generation if item.lease else item.revision + 1,
            now,
            now + ttl_ms,
        )
        updated = replace(
            item, status="in_progress", revision=item.revision + 1, lease=lease
        )
        self._items[item_id] = updated
        return ClaimResult(True, item=updated, lease=lease)

    def heartbeat(self, item_id: str, token: str, ttl_ms: int) -> WorkItem:
        _require_positive(ttl_ms, "heartbeat ttl")
        item = self._require_active_lease(item_id, token)
        now = self._clock.now()
        assert item.lease is not None
        updated = replace(
            item,
            revision=item.revision + 1,
            lease=replace(item.lease, heartbeat_at=now, expires_at=now + ttl_ms),
        )
        self._items[item_id] = updated
        return updated

    def complete(self, item_id: str, token: str) -> WorkItem:
        item = self._require_active_lease(item_id, token)
        updated = replace(
            item, status="completed", revision=item.revision + 1, lease=None
        )
        self._items[item_id] = updated
        return updated

    def release(self, item_id: str, token: str) -> WorkItem:
        item = self._require_active_lease(item_id, token)
        updated = replace(
            item, status="pending", revision=item.revision + 1, lease=None
        )
        self._items[item_id] = updated
        return updated

    def reclaim_expired(self) -> tuple[str, ...]:
        reclaimed: list[str] = []
        for item_id, item in tuple(self._items.items()):
            if self._expire_if_needed(item) != item:
                reclaimed.append(item_id)
        return tuple(reclaimed)

    def _expire_if_needed(self, item: WorkItem) -> WorkItem:
        if item.lease is None or item.lease.expires_at > self._clock.now():
            return item
        updated = replace(
            item, status="pending", revision=item.revision + 1, lease=None
        )
        self._items[item.id] = updated
        return updated

    def _require_active_lease(self, item_id: str, token: str) -> WorkItem:
        found = self._items.get(item_id)
        if found is None:
            raise ValueError(f"unknown work item: {item_id}")
        item = self._expire_if_needed(found)
        if item.lease is None or item.lease.token != token:
            raise ValueError(f"stale or missing lease: {item_id}")
        return item


class ExecutionSignal:
    def __init__(self) -> None:
        self.cancelled = False
        self.reason = "execution cancelled"
        self._callbacks: list[Callable[[str], None]] = []

    def cancel(self, reason: str = "execution cancelled") -> None:
        if self.cancelled:
            return
        self.cancelled = True
        self.reason = reason
        for callback in tuple(self._callbacks):
            callback(reason)

    def subscribe(self, callback: Callable[[str], None]) -> Callable[[], None]:
        if self.cancelled:
            callback(self.reason)
            return lambda: None
        self._callbacks.append(callback)
        return lambda: self._callbacks.remove(callback) if callback in self._callbacks else None

    def throw_if_cancelled(self) -> None:
        if self.cancelled:
            raise asyncio.CancelledError(self.reason)


@dataclass(frozen=True)
class RuntimeExecution:
    id: str
    work_item_id: str
    owner_id: str
    mode: Literal["foreground", "background"]
    cancellation: Literal["linked", "detached"]
    status: Literal["running", "completed", "failed", "cancelled"]
    revision: int
    started_at: int
    ended_at: int | None = None
    failure_type: str | None = None


@dataclass(frozen=True)
class RuntimeExecutionHandle:
    execution: RuntimeExecution
    signal: ExecutionSignal
    done: asyncio.Task[RuntimeExecution]
    cancel: Callable[[str], None]


class RuntimeExecutionRegistry:
    def __init__(self, clock: Clock | None = None) -> None:
        self._clock = clock or SystemClock()
        self._executions: dict[str, RuntimeExecution] = {}
        self._signals: dict[str, ExecutionSignal] = {}

    def launch(
        self,
        *,
        execution_id: str,
        work_item_id: str,
        owner_id: str,
        mode: Literal["foreground", "background"],
        run: Callable[[ExecutionSignal], Awaitable[None]],
        cancellation: Literal["linked", "detached"] = "linked",
        parent_signal: ExecutionSignal | None = None,
    ) -> RuntimeExecutionHandle:
        if execution_id in self._executions:
            raise ValueError(f"duplicate execution: {execution_id}")
        signal = ExecutionSignal()
        execution = RuntimeExecution(
            execution_id,
            work_item_id,
            owner_id,
            mode,
            cancellation,
            "running",
            1,
            self._clock.now(),
        )
        self._executions[execution_id] = execution
        self._signals[execution_id] = signal
        unsubscribe = (
            parent_signal.subscribe(signal.cancel)
            if cancellation == "linked" and parent_signal is not None
            else lambda: None
        )

        async def owner() -> RuntimeExecution:
            status: Literal["completed", "failed", "cancelled"] = "completed"
            failure_type: str | None = None
            try:
                signal.throw_if_cancelled()
                await run(signal)
                if signal.cancelled:
                    status = "cancelled"
            except asyncio.CancelledError:
                status = "cancelled"
            except Exception as error:
                status = "cancelled" if signal.cancelled else "failed"
                failure_type = type(error).__name__
            finally:
                unsubscribe()
                self._signals.pop(execution_id, None)
            current = self._executions[execution_id]
            updated = replace(
                current,
                status=status,
                revision=current.revision + 1,
                ended_at=self._clock.now(),
                failure_type=failure_type,
            )
            self._executions[execution_id] = updated
            return updated

        done = asyncio.create_task(owner())
        return RuntimeExecutionHandle(execution, signal, done, signal.cancel)

    def get(self, execution_id: str) -> RuntimeExecution | None:
        return self._executions.get(execution_id)

    def cancel(self, execution_id: str, reason: str = "execution cancelled") -> bool:
        signal = self._signals.get(execution_id)
        if signal is None:
            return False
        signal.cancel(reason)
        return True


@dataclass(frozen=True)
class TeamMember:
    agent_id: str
    display_name: str
    role: str
    status: Literal["active", "stopping", "stopped"] = "active"
    revision: int = 1


@dataclass(frozen=True)
class TeamSnapshot:
    team_id: str
    revision: int
    leader_id: str
    members: tuple[TeamMember, ...]


class TeamDirectory:
    def __init__(self) -> None:
        self._teams: dict[str, TeamSnapshot] = {}

    def create(self, team_id: str, leader: TeamMember) -> TeamSnapshot:
        if team_id in self._teams:
            raise ValueError(f"duplicate team: {team_id}")
        team = TeamSnapshot(team_id, 1, leader.agent_id, (leader,))
        self._teams[team_id] = team
        return team

    def add_member(self, team_id: str, member: TeamMember) -> TeamSnapshot:
        team = self.require(team_id)
        if any(item.agent_id == member.agent_id for item in team.members):
            raise ValueError(f"duplicate team member: {member.agent_id}")
        if any(item.display_name == member.display_name for item in team.members):
            raise ValueError(f"duplicate team display name: {member.display_name}")
        updated = replace(
            team, revision=team.revision + 1, members=team.members + (member,)
        )
        self._teams[team_id] = updated
        return updated

    def set_member_status(
        self,
        team_id: str,
        agent_id: str,
        status: Literal["active", "stopping", "stopped"],
    ) -> TeamSnapshot:
        team = self.require(team_id)
        if not any(item.agent_id == agent_id for item in team.members):
            raise ValueError(f"unknown team member: {agent_id}")
        members = tuple(
            replace(item, status=status, revision=item.revision + 1)
            if item.agent_id == agent_id
            else item
            for item in team.members
        )
        updated = replace(team, revision=team.revision + 1, members=members)
        self._teams[team_id] = updated
        return updated

    def require(self, team_id: str) -> TeamSnapshot:
        team = self._teams.get(team_id)
        if team is None:
            raise ValueError(f"unknown team: {team_id}")
        return team

    def has_member(self, team_id: str, agent_id: str) -> bool:
        return any(item.agent_id == agent_id for item in self.require(team_id).members)


@dataclass(frozen=True)
class MailboxEnvelope:
    message_id: str
    team_id: str
    sender_id: str
    recipient_id: str
    kind: str
    sequence: int
    sent_at: int
    payload: object
    delivery_count: int = 0
    acknowledged_at: int | None = None


@dataclass(frozen=True)
class MailboxSendResult:
    duplicate: bool
    envelope: MailboxEnvelope


class AcknowledgedMailbox:
    def __init__(self, clock: Clock | None = None) -> None:
        self._clock = clock or SystemClock()
        self._messages: dict[str, MailboxEnvelope] = {}
        self._next_sequence: dict[str, int] = {}

    def send(
        self,
        *,
        message_id: str,
        team_id: str,
        sender_id: str,
        recipient_id: str,
        kind: str,
        payload: object,
    ) -> MailboxSendResult:
        existing = self._messages.get(message_id)
        if existing is not None:
            identity = (team_id, sender_id, recipient_id, kind)
            if identity != (
                existing.team_id,
                existing.sender_id,
                existing.recipient_id,
                existing.kind,
            ):
                raise ValueError(f"mailbox message id collision: {message_id}")
            return MailboxSendResult(True, existing)
        sequence = self._next_sequence.get(recipient_id, 0) + 1
        self._next_sequence[recipient_id] = sequence
        envelope = MailboxEnvelope(
            message_id,
            team_id,
            sender_id,
            recipient_id,
            kind,
            sequence,
            self._clock.now(),
            deepcopy(payload),
        )
        self._messages[message_id] = envelope
        return MailboxSendResult(False, envelope)

    def receive(self, recipient_id: str, limit: int = 2**31 - 1) -> tuple[MailboxEnvelope, ...]:
        _require_positive(limit, "mailbox receive limit")
        pending = sorted(
            (
                item
                for item in self._messages.values()
                if item.recipient_id == recipient_id
                and item.acknowledged_at is None
            ),
            key=lambda item: item.sequence,
        )[:limit]
        delivered: list[MailboxEnvelope] = []
        for item in pending:
            updated = replace(item, delivery_count=item.delivery_count + 1)
            self._messages[item.message_id] = updated
            delivered.append(updated)
        return tuple(delivered)

    def acknowledge(self, message_id: str, recipient_id: str) -> MailboxEnvelope:
        message = self._messages.get(message_id)
        if message is None or message.recipient_id != recipient_id:
            raise ValueError(f"mailbox message not owned by recipient: {message_id}")
        if message.acknowledged_at is not None:
            return message
        updated = replace(message, acknowledged_at=self._clock.now())
        self._messages[message_id] = updated
        return updated


@dataclass(frozen=True)
class ShutdownRequest:
    request_id: str
    team_id: str
    requester_id: str
    target_id: str
    status: Literal["pending", "approved", "rejected", "completed"]
    revision: int
    created_at: int
    responded_at: int | None = None


class ShutdownCoordinator:
    def __init__(self, teams: TeamDirectory, clock: Clock | None = None) -> None:
        self._teams = teams
        self._clock = clock or SystemClock()
        self._requests: dict[str, ShutdownRequest] = {}

    def request(
        self, request_id: str, team_id: str, requester_id: str, target_id: str
    ) -> ShutdownRequest:
        if request_id in self._requests:
            raise ValueError(f"duplicate shutdown request: {request_id}")
        if not self._teams.has_member(team_id, requester_id):
            raise ValueError("shutdown requester is not a team member")
        if not self._teams.has_member(team_id, target_id):
            raise ValueError("shutdown target is not a team member")
        request = ShutdownRequest(
            request_id,
            team_id,
            requester_id,
            target_id,
            "pending",
            1,
            self._clock.now(),
        )
        self._requests[request_id] = request
        return request

    def respond(
        self, request_id: str, responder_id: str, approved: bool
    ) -> ShutdownRequest:
        request = self._requests.get(request_id)
        if request is None:
            raise ValueError(f"unknown shutdown request: {request_id}")
        if request.status != "pending":
            raise ValueError(f"shutdown request already answered: {request_id}")
        if request.target_id != responder_id:
            raise ValueError("only the shutdown target can respond")
        updated = replace(
            request,
            status="approved" if approved else "rejected",
            revision=request.revision + 1,
            responded_at=self._clock.now(),
        )
        self._requests[request_id] = updated
        if approved:
            self._teams.set_member_status(request.team_id, request.target_id, "stopping")
        return updated

    def complete(self, request_id: str) -> ShutdownRequest:
        request = self._requests.get(request_id)
        if request is None or request.status != "approved":
            raise ValueError(f"shutdown request is not approved: {request_id}")
        self._teams.set_member_status(request.team_id, request.target_id, "stopped")
        updated = replace(request, status="completed", revision=request.revision + 1)
        self._requests[request_id] = updated
        return updated


@dataclass(frozen=True)
class Schedule:
    schedule_id: str
    work_item_id: str
    next_run_at: int
    interval_ms: int | None
    revision: int


@dataclass(frozen=True)
class ScheduledTrigger:
    trigger_id: str
    schedule_id: str
    work_item_id: str
    scheduled_for: int
    observed_at: int
    outcome: Literal["due", "missed"]


@dataclass(frozen=True)
class DurableSchedulerState:
    revision: int
    schedules: tuple[Schedule, ...]
    pending: tuple[ScheduledTrigger, ...]


class DurableScheduler:
    def __init__(
        self,
        *,
        missed_after_ms: int = 60_000,
        state: DurableSchedulerState | None = None,
    ) -> None:
        if missed_after_ms < 0:
            raise ValueError("missed_after_ms must not be negative")
        self._missed_after_ms = missed_after_ms
        self._revision = state.revision if state else 0
        self._schedules = (
            {item.schedule_id: item for item in state.schedules} if state else {}
        )
        self._pending = (
            {item.trigger_id: item for item in state.pending} if state else {}
        )

    def schedule(
        self,
        schedule_id: str,
        work_item_id: str,
        next_run_at: int,
        interval_ms: int | None = None,
    ) -> Schedule:
        if schedule_id in self._schedules:
            raise ValueError(f"duplicate schedule: {schedule_id}")
        if interval_ms is not None:
            _require_positive(interval_ms, "schedule interval")
        schedule = Schedule(schedule_id, work_item_id, next_run_at, interval_ms, 1)
        self._schedules[schedule_id] = schedule
        self._revision += 1
        return schedule

    def poll(self, now: int) -> tuple[ScheduledTrigger, ...]:
        due = list(self._pending.values())
        for schedule in tuple(self._schedules.values()):
            if schedule.next_run_at > now:
                continue
            trigger_id = f"{schedule.schedule_id}@{schedule.next_run_at}"
            if trigger_id in self._pending:
                continue
            trigger = ScheduledTrigger(
                trigger_id,
                schedule.schedule_id,
                schedule.work_item_id,
                schedule.next_run_at,
                now,
                "missed"
                if now - schedule.next_run_at > self._missed_after_ms
                else "due",
            )
            self._pending[trigger_id] = trigger
            self._revision += 1
            due.append(trigger)
        return tuple(sorted(due, key=lambda item: item.scheduled_for))

    def commit(self, trigger_id: str, completed_at: int) -> None:
        trigger = self._pending.get(trigger_id)
        if trigger is None:
            raise ValueError(f"unknown pending trigger: {trigger_id}")
        schedule = self._schedules.get(trigger.schedule_id)
        if schedule is None:
            raise ValueError(f"trigger schedule is missing: {trigger.schedule_id}")
        del self._pending[trigger_id]
        if schedule.interval_ms is None:
            del self._schedules[schedule.schedule_id]
        else:
            self._schedules[schedule.schedule_id] = replace(
                schedule,
                next_run_at=completed_at + schedule.interval_ms,
                revision=schedule.revision + 1,
            )
        self._revision += 1

    def export_state(self) -> DurableSchedulerState:
        return DurableSchedulerState(
            self._revision,
            tuple(self._schedules.values()),
            tuple(self._pending.values()),
        )


@dataclass(frozen=True)
class WorkCoordinatorTrace:
    type: str
    entity_id: str
    status: str
    revision: int
    related_count: int


def metadata_trace(
    type_: str,
    entity_id: str,
    status: str,
    revision: int,
    related_count: int = 0,
) -> WorkCoordinatorTrace:
    return WorkCoordinatorTrace(type_, entity_id, status, revision, related_count)


def _require_text(value: str, label: str) -> None:
    if not value.strip():
        raise ValueError(f"{label} must not be empty")


def _require_positive(value: int, label: str) -> None:
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{label} must be positive")
