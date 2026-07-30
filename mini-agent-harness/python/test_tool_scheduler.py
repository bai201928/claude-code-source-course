from __future__ import annotations

import asyncio
import unittest
from collections.abc import Mapping

from agent_runtime import (
    AgentTool,
    CancellationSignal,
    ModelToolCall,
    PermissionGate,
    PermissionRequest,
    ToolContext,
    ToolProgress,
    ToolRegistry,
    ToolScheduler,
)


def call(name: str) -> ModelToolCall:
    return ModelToolCall(f"call-{name}", name, {})


def tool(
    name: str,
    safe: bool,
    execute,
    *,
    risk: str = "read",
    command: str | None = None,
    context_update=None,
) -> AgentTool:
    return AgentTool(
        name,
        name,
        {"type": "object"},
        risk,  # type: ignore[arg-type]
        execute,
        lambda _input: PermissionRequest(
            name, risk, command  # type: ignore[arg-type]
        ),
        lambda _input: safe,
        context_update,
    )


class ToolSchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_safe_batches_wait_at_exclusive_barriers(self) -> None:
        timeline: list[str] = []
        releases = {name: asyncio.Event() for name in "ABCD"}
        starts = {name: asyncio.Event() for name in "ABCD"}
        registry = ToolRegistry()

        for name, safe in (("A", True), ("B", True), ("C", False), ("D", True)):
            async def execute(
                _input: Mapping[str, object],
                _context: ToolContext,
                current=name,
            ) -> object:
                timeline.append(f"start:{current}")
                starts[current].set()
                await releases[current].wait()
                timeline.append(f"end:{current}")
                return current

            registry.register(
                tool(
                    name,
                    safe,
                    execute,
                    risk="read" if safe else "execute",
                    command=None if safe else name,
                )
            )

        scheduler = ToolScheduler(registry, 2)
        plan = scheduler.plan(tuple(call(name) for name in "ABCD"))
        self.assertEqual(
            tuple((batch.mode, tuple(item.name for item in batch.calls)) for batch in plan.batches),
            (("concurrent", ("A", "B")), ("exclusive", ("C",)), ("concurrent", ("D",))),
        )
        pending = asyncio.create_task(
            scheduler.execute(
                plan,
                signal=CancellationSignal(),
                gate=PermissionGate(("C",)),
            )
        )
        await asyncio.gather(starts["A"].wait(), starts["B"].wait())
        self.assertNotIn("start:C", timeline)
        releases["A"].set()
        releases["B"].set()
        await starts["C"].wait()
        self.assertNotIn("start:D", timeline)
        releases["C"].set()
        await starts["D"].wait()
        releases["D"].set()
        outcomes, _context = await pending
        self.assertEqual(tuple(outcome.call.id for outcome in outcomes), tuple(f"call-{name}" for name in "ABCD"))

    async def test_bounds_concurrency_and_orders_context_updates(self) -> None:
        active = 0
        peak = 0
        registry = ToolRegistry()

        for name, delay in (("A", 0.03), ("B", 0.005), ("D", 0.005)):
            async def execute(_input, _context, current=name, wait=delay):
                nonlocal active, peak
                active += 1
                peak = max(peak, active)
                await asyncio.sleep(wait)
                active -= 1
                return current

            registry.register(
                tool(
                    name,
                    True,
                    execute,
                    context_update=lambda _input, _output, current=name: {"winner": current},
                )
            )

        scheduler = ToolScheduler(registry, 2)
        outcomes, context = await scheduler.execute(
            scheduler.plan(tuple(call(name) for name in ("A", "B", "D"))),
            signal=CancellationSignal(),
            gate=PermissionGate(),
        )
        self.assertEqual(peak, 2)
        self.assertEqual(tuple(outcome.output for outcome in outcomes), ("A", "B", "D"))
        self.assertEqual(context["winner"], "D")

    async def test_invalid_denied_and_thrown_calls_keep_exact_pairing(self) -> None:
        classified = False
        invalid_executed = False

        def classify(_input) -> bool:
            nonlocal classified
            classified = True
            return True

        async def invalid(_input, _context):
            nonlocal invalid_executed
            invalid_executed = True
            return "bad"

        async def throws(_input, _context):
            raise RuntimeError("boom")

        registry = ToolRegistry()
        registry.register(
            AgentTool(
                "invalid",
                "invalid",
                {
                    "type": "object",
                    "properties": {"count": {"type": "integer"}},
                    "required": ["count"],
                    "additionalProperties": False,
                },
                "read",
                invalid,
                lambda _input: PermissionRequest("invalid", "read"),
                classify,
            )
        )
        registry.register(tool("denied", False, invalid, risk="execute", command="denied"))
        registry.register(tool("throws", True, throws))
        calls = (
            ModelToolCall("invalid-id", "invalid", {"count": "x"}),
            ModelToolCall("denied-id", "denied", {}),
            ModelToolCall("throw-id", "throws", {}),
        )
        scheduler = ToolScheduler(registry, 2)
        outcomes, _context = await scheduler.execute(
            scheduler.plan(calls),
            signal=CancellationSignal(),
            gate=PermissionGate(),
        )
        self.assertFalse(classified)
        self.assertFalse(invalid_executed)
        self.assertEqual(tuple(outcome.status for outcome in outcomes), ("error", "denied", "error"))
        self.assertEqual(len({outcome.call.id for outcome in outcomes}), 3)

    async def test_progress_arrives_before_final_outcome(self) -> None:
        timeline: list[str] = []

        async def progressive(_input, context: ToolContext):
            assert context.report_progress is not None
            await context.report_progress(ToolProgress("half", 1, 2))
            timeline.append("execute:end")
            return "done"

        async def progress(_call, item: ToolProgress):
            timeline.append(f"progress:{item.stage}")

        registry = ToolRegistry()
        registry.register(tool("progressive", True, progressive))
        scheduler = ToolScheduler(registry)
        outcomes, _context = await scheduler.execute(
            scheduler.plan((call("progressive"),)),
            signal=CancellationSignal(),
            gate=PermissionGate(),
            progress=progress,
        )
        timeline.append(f"result:{outcomes[0].status}")
        self.assertEqual(timeline, ["progress:half", "execute:end", "result:success"])

    async def test_cancellation_returns_one_outcome_per_call(self) -> None:
        signal = CancellationSignal()

        async def cancel(_input, _context):
            signal.cancel("cancel now")
            raise RuntimeError("cancel now")

        async def later(_input, _context):
            return "must not succeed"

        registry = ToolRegistry()
        registry.register(tool("cancel", True, cancel))
        registry.register(tool("later", True, later))
        registry.register(tool("barrier", False, later, risk="execute", command="barrier"))
        calls = tuple(call(name) for name in ("cancel", "later", "barrier"))
        scheduler = ToolScheduler(registry, 1)
        outcomes, _context = await scheduler.execute(
            scheduler.plan(calls), signal=signal, gate=PermissionGate(("barrier",))
        )
        self.assertEqual(tuple(outcome.status for outcome in outcomes), ("cancelled", "cancelled", "cancelled"))
        self.assertEqual(len({outcome.call.id for outcome in outcomes}), len(calls))


if __name__ == "__main__":
    unittest.main()
