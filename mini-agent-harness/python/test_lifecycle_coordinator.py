import asyncio
import unittest

from lifecycle_coordinator import LifecycleCoordinator, ShutdownRequest


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
    async def test_tier_order_and_parallel_start(self) -> None:
        coordinator = LifecycleCoordinator()
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

        coordinator.register("checkpoint", "critical", critical_a)
        coordinator.register("history", "critical", critical_b)
        coordinator.register("mcp", "resource", resource)
        await coordinator.shutdown(request())
        self.assertLess(trace.index("critical-b:start"), trace.index("critical-a:end"))
        self.assertGreater(trace.index("resource:start"), trace.index("critical-b:end"))

    async def test_failure_isolated_from_peers_and_later_tiers(self) -> None:
        coordinator = LifecycleCoordinator()

        async def bad(_token) -> None:
            raise RuntimeError("disk unavailable")

        async def good(_token) -> None:
            return None

        coordinator.register("bad", "critical", bad)
        coordinator.register("good", "critical", good)
        coordinator.register("resource", "resource", good)
        report = await coordinator.shutdown(request())
        self.assertEqual(
            tuple((item.name, item.status) for item in report.results),
            (("bad", "failed"), ("good", "completed"), ("resource", "completed")),
        )

    async def test_timeout_sends_cooperative_reason(self) -> None:
        coordinator = LifecycleCoordinator()
        reasons: list[str | None] = []

        async def slow(token) -> None:
            await token.wait()
            reasons.append(token.reason)

        coordinator.register("slow-mcp", "resource", slow)
        report = await coordinator.shutdown(request(100, resource=15))
        await asyncio.sleep(0)
        self.assertEqual(report.results[0].status, "timed-out")
        self.assertEqual(reasons, ["cleanup-tier-timeout:resource"])

    async def test_first_shutdown_owns_shared_task(self) -> None:
        coordinator = LifecycleCoordinator()
        first = coordinator.shutdown(request())
        second = coordinator.shutdown(
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
        coordinator = LifecycleCoordinator()

        async def noop(_token) -> None:
            return None

        unregister = coordinator.register("temporary", "resource", noop)
        unregister()
        shutdown = coordinator.shutdown(request())
        with self.assertRaisesRegex(ValueError, "cannot register cleanup"):
            coordinator.register("late", "critical", noop)
        self.assertEqual((await shutdown).results, ())

    async def test_prepare_and_hint_precede_cleanup(self) -> None:
        trace: list[str] = []

        def prepare(_request) -> str:
            trace.append("prepare")
            return "resume session-42"

        coordinator = LifecycleCoordinator(prepare=prepare)

        async def checkpoint(_token) -> None:
            trace.append("cleanup")

        coordinator.register("checkpoint", "critical", checkpoint)
        report = await coordinator.shutdown(request())
        self.assertEqual(trace, ["prepare", "cleanup"])
        self.assertEqual(report.recovery_hint, "resume session-42")

    async def test_deadline_invokes_failsafe_and_skips_lower_tiers(self) -> None:
        calls = 0

        def failsafe(_request) -> None:
            nonlocal calls
            calls += 1

        coordinator = LifecycleCoordinator(on_failsafe=failsafe)

        async def hung(token) -> None:
            await token.wait()

        async def noop(_token) -> None:
            return None

        coordinator.register("hung-critical", "critical", hung)
        coordinator.register("resource", "resource", noop)
        coordinator.register("analytics", "best-effort", noop)
        report = await coordinator.shutdown(request(15, critical=15))
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

    async def test_invalid_budget_does_not_take_lifecycle_ownership(self) -> None:
        coordinator = LifecycleCoordinator()
        with self.assertRaisesRegex(ValueError, "overall_budget_ms must be positive"):
            coordinator.shutdown(request(float("inf")))
        self.assertEqual(coordinator.state, "running")


if __name__ == "__main__":
    unittest.main()
