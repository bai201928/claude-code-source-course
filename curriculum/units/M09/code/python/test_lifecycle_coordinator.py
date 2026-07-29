import asyncio
import unittest

from lifecycle_coordinator import (
    LifecycleCoordinator,
    ShutdownRequest,
    SnapshotCleanupRegistry,
)


def request(
    overall_ms: float = 200,
    *,
    critical: float = 80,
    resource: float = 70,
    best_effort: float = 40,
) -> ShutdownRequest:
    return ShutdownRequest(
        "user-exit",
        0,
        overall_ms,
        {
            "critical": critical,
            "resource": resource,
            "best-effort": best_effort,
        },
    )


class LifecycleCoordinatorTests(unittest.IsolatedAsyncioTestCase):
    async def test_snapshot_gather_starts_all_and_does_not_cancel_slow_peer(self) -> None:
        registry = SnapshotCleanupRegistry()
        trace: list[str] = []
        release = asyncio.Event()

        async def slow() -> None:
            trace.append("slow:start")
            await release.wait()
            trace.append("slow:done")

        async def fail() -> None:
            trace.append("fail:start")
            raise RuntimeError("boom")

        registry.register(slow)
        registry.register(fail)
        task = asyncio.create_task(registry.run())
        await asyncio.sleep(0)
        with self.assertRaisesRegex(RuntimeError, "boom"):
            await task
        trace.append("registry:rejected")
        release.set()
        await asyncio.sleep(0)
        self.assertEqual(
            trace,
            ["slow:start", "fail:start", "registry:rejected", "slow:done"],
        )

    async def test_tiers_are_sequential_and_tier_handlers_start_together(self) -> None:
        manager = LifecycleCoordinator()
        trace: list[str] = []

        async def critical_a(_token) -> None:
            trace.append("critical-a:start")
            await asyncio.sleep(0)
            trace.append("critical-a:end")

        async def critical_b(_token) -> None:
            trace.append("critical-b:start")
            await asyncio.sleep(0)
            trace.append("critical-b:end")

        async def resource(_token) -> None:
            trace.append("resource:start")

        manager.register("checkpoint", "critical", critical_a)
        manager.register("history", "critical", critical_b)
        manager.register("mcp", "resource", resource)
        await manager.shutdown(request())
        self.assertLess(trace.index("critical-b:start"), trace.index("critical-a:end"))
        self.assertGreater(trace.index("resource:start"), trace.index("critical-b:end"))

    async def test_failure_is_reported_without_skipping_peers(self) -> None:
        manager = LifecycleCoordinator()

        async def bad(_token) -> None:
            raise RuntimeError("disk unavailable")

        async def good(_token) -> None:
            return None

        manager.register("bad", "critical", bad)
        manager.register("good", "critical", good)
        manager.register("resource", "resource", good)
        report = await manager.shutdown(request())
        self.assertEqual(
            tuple((item.name, item.status) for item in report.results),
            (("bad", "failed"), ("good", "completed"), ("resource", "completed")),
        )

    async def test_tier_timeout_is_cooperative_and_reported(self) -> None:
        manager = LifecycleCoordinator()
        reasons: list[str | None] = []

        async def slow(token) -> None:
            await token.wait()
            reasons.append(token.reason)

        manager.register("slow-mcp", "resource", slow)
        report = await manager.shutdown(request(100, resource=15))
        await asyncio.sleep(0)
        self.assertEqual(report.results[0].status, "timed-out")
        self.assertEqual(reasons, ["cleanup-tier-timeout:resource"])

    async def test_first_shutdown_owns_shared_task_and_report(self) -> None:
        manager = LifecycleCoordinator()
        first = manager.shutdown(request())
        second = manager.shutdown(
            ShutdownRequest(
                "SIGTERM",
                143,
                200,
                {"critical": 80, "resource": 70, "best-effort": 40},
            )
        )
        self.assertIs(first, second)
        report = await first
        self.assertEqual((report.reason, report.exit_code), ("user-exit", 0))

    async def test_unregister_and_late_registration(self) -> None:
        manager = LifecycleCoordinator()

        async def noop(_token) -> None:
            return None

        unregister = manager.register("temporary", "resource", noop)
        unregister()
        task = manager.shutdown(request())
        with self.assertRaisesRegex(ValueError, "cannot register cleanup"):
            manager.register("late", "critical", noop)
        report = await task
        self.assertEqual(report.results, ())

    async def test_prepare_and_hint_precede_cleanup(self) -> None:
        trace: list[str] = []

        def prepare(_request) -> str:
            trace.append("prepare")
            return "resume session-42"

        manager = LifecycleCoordinator(prepare=prepare)

        async def checkpoint(_token) -> None:
            trace.append("cleanup")

        manager.register("checkpoint", "critical", checkpoint)
        report = await manager.shutdown(request())
        self.assertEqual(trace, ["prepare", "cleanup"])
        self.assertEqual(report.recovery_hint, "resume session-42")

    async def test_overall_deadline_triggers_failsafe_and_skips_lower_tiers(self) -> None:
        calls = 0

        def failsafe(_request) -> None:
            nonlocal calls
            calls += 1

        manager = LifecycleCoordinator(on_failsafe=failsafe)

        async def hung(token) -> None:
            await token.wait()

        async def noop(_token) -> None:
            return None

        manager.register("hung-critical", "critical", hung)
        manager.register("resource", "resource", noop)
        manager.register("analytics", "best-effort", noop)
        report = await manager.shutdown(request(15, critical=15))
        self.assertTrue(report.deadline_exceeded)
        self.assertEqual(calls, 1)
        self.assertEqual(
            tuple((item.name, item.status) for item in report.results),
            (
                ("hung-critical", "timed-out"),
                ("resource", "skipped"),
                ("analytics", "skipped"),
            ),
        )


if __name__ == "__main__":
    unittest.main()
