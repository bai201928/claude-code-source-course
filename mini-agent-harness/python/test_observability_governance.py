import asyncio
import json
import unittest
from dataclasses import asdict, replace

from observability_governance import (
    AttemptIdentity,
    EvaluationDimension,
    EvaluationLedger,
    EvaluationRecord,
    EventCollisionError,
    ReservationCancelledError,
    ReservationRequest,
    TelemetryEvent,
    TelemetryRecorder,
    TenantGovernor,
    TenantLimit,
    TenantQueueFullError,
    TokenPrice,
    UsageCostCommand,
    UsageCostLedger,
    UsageSnapshot,
)


def identity(attempt_id="attempt-1", route="primary"):
    return AttemptIdentity("run-1", "request-1", attempt_id, route)


def usage(event_id, output_tokens, **changes):
    command = UsageCostCommand(
        event_id,
        identity(),
        "model-a",
        "prices-2026-07",
        100,
        UsageSnapshot(10, output_tokens),
        TokenPrice(1, 2, 0.1, 1.25),
    )
    return replace(command, **changes)


class FailingPort:
    def export(self, _event):
        raise RuntimeError("export down")


class MemoryPort:
    def __init__(self):
        self.events = []

    def export(self, event):
        self.events.append(event)


class ObservabilityGovernanceTests(unittest.IsolatedAsyncioTestCase):
    def test_cumulative_snapshot_converts_to_delta(self):
        ledger = UsageCostLedger()
        ledger.record(usage("usage-1", 100))
        second = ledger.record(usage("usage-2", 130, captured_at_ms=200))
        self.assertEqual(second.delta.output_tokens, 30)
        self.assertEqual(sum(item.delta.output_tokens for item in ledger.entries()), 130)

    def test_usage_idempotency_and_collision(self):
        ledger = UsageCostLedger()
        command = usage("usage-1", 100)
        self.assertIs(ledger.record(command), ledger.record(command))
        self.assertEqual(len(ledger.entries()), 1)
        with self.assertRaises(EventCollisionError):
            ledger.record(usage("usage-1", 101))

    def test_retry_fallback_attempt_identity(self):
        ledger = UsageCostLedger()
        ledger.record(usage("retry", 50, identity=identity("retry-1", "retry")))
        ledger.record(usage("fallback", 70, identity=identity("fallback-1", "fallback")))
        self.assertEqual([entry.delta.output_tokens for entry in ledger.entries()], [50, 70])
        self.assertEqual([entry.identity.route for entry in ledger.entries()], ["retry", "fallback"])

    def test_unknown_cost_and_ttft_are_explicit(self):
        entry = UsageCostLedger().record(usage("unknown", 20, price=None))
        self.assertEqual(entry.cost_status, "unknown")
        self.assertIsNone(entry.cost_usd)
        self.assertEqual(entry.ttft_status, "unknown")
        self.assertIsNone(entry.ttft_ms)

    async def test_observer_failure_is_isolated(self):
        recorder = TelemetryRecorder(FailingPort())
        delivered = await recorder.record(
            TelemetryEvent("attempt_started", "trace-1", 100, "run-1", "request-1", "attempt-1", route="primary", retry_ordinal=0)
        )
        self.assertFalse(delivered)
        self.assertEqual(recorder.report()["observer_failure_count"], 1)

    async def test_fixed_telemetry_has_no_content_fields(self):
        port = MemoryPort()
        recorder = TelemetryRecorder(port)
        await recorder.record(
            TelemetryEvent(
                "tool_finished", "trace-tool", 100, "run-1",
                tool_call_id="call-1", outcome="succeeded", duration_ms=20,
            )
        )
        serialized = json.dumps([asdict(event) for event in port.events])
        for forbidden in ("user prompt value", "tool result value", "secret-key-value"):
            self.assertNotIn(forbidden, serialized)
        for field in ("prompt", "tool_result", "secret"):
            self.assertNotIn(f'"{field}"', serialized)

    def test_evaluation_is_versioned_and_idempotent(self):
        ledger = EvaluationLedger()
        record = EvaluationRecord(
            "eval-event-1", "run-1", "eval-1", "answer-quality", 2,
            "judge-3", "passed", (EvaluationDimension("correctness", 0.9, True),), 300,
        )
        self.assertIs(ledger.record(record), ledger.record(record))
        with self.assertRaises(EventCollisionError):
            ledger.record(replace(record, outcome="failed"))

    async def test_reservations_prevent_oversubscription(self):
        governor = TenantGovernor(
            {"acme": TenantLimit(100, 1, 1, 2)}, now=lambda: 200
        )
        await governor.reserve(ReservationRequest("acme", "r1", 70, 0.7, 100))
        queued = asyncio.create_task(
            governor.reserve(ReservationRequest("acme", "r2", 40, 0.4, 101))
        )
        await asyncio.sleep(0)
        report = governor.report("acme")
        self.assertEqual(report.active_concurrency, 1)
        self.assertEqual(report.queue_depth, 1)
        self.assertEqual(report.reserved_tokens, 70)
        governor.cancel("acme", "r1")
        self.assertEqual((await queued).reservation_id, "r2")

    async def test_tenant_queue_is_bounded_fifo(self):
        governor = TenantGovernor({"noisy": TenantLimit(100, 10, 1, 1)})
        await governor.reserve(ReservationRequest("noisy", "active", 1, 0.1, 1))
        queued = asyncio.create_task(
            governor.reserve(ReservationRequest("noisy", "queued", 1, 0.1, 2))
        )
        await asyncio.sleep(0)
        with self.assertRaises(TenantQueueFullError):
            await governor.reserve(ReservationRequest("noisy", "overflow", 1, 0.1, 3))
        governor.complete("noisy", "active", 1, 0.1)
        self.assertEqual((await queued).reservation_id, "queued")

    async def test_complete_and_cancel_release_concurrency(self):
        governor = TenantGovernor({"team": TenantLimit(100, 10, 1, 2)})
        await governor.reserve(ReservationRequest("team", "r1", 10, 1, 1))
        second = asyncio.create_task(
            governor.reserve(ReservationRequest("team", "r2", 10, 1, 2))
        )
        await asyncio.sleep(0)
        governor.complete("team", "r1", 8, 0.8)
        await second
        third = asyncio.create_task(
            governor.reserve(ReservationRequest("team", "r3", 10, 1, 3))
        )
        await asyncio.sleep(0)
        governor.cancel("team", "r3")
        with self.assertRaises(ReservationCancelledError):
            await third
        governor.cancel("team", "r2")
        self.assertEqual(governor.report("team").active_concurrency, 0)


if __name__ == "__main__":
    unittest.main()
