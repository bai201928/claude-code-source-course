from __future__ import annotations

import asyncio
import unittest

from tool_scheduler import Call, Scheduler, Tool, compare_snapshot_policies


def call(name: str) -> Call:
    return Call(f"id-{name}", name, {})


def tool(name: str, safe: bool, delay: float = 0, update=None) -> Tool:
    async def run(_input, _progress, cancelled):
        if delay:
            await asyncio.sleep(delay)
        if cancelled.is_set():
            raise RuntimeError("cancelled")
        return name, update

    return Tool(name, lambda value: value, lambda _value: safe, lambda _value: "allow", run)


class SchedulerTests(unittest.IsolatedAsyncioTestCase):
    def test_plan_builds_safe_batches_around_barrier(self) -> None:
        scheduler = Scheduler(
            (tool("A", True), tool("B", True), tool("C", False), tool("D", True))
        )
        self.assertEqual(
            tuple((batch.mode, tuple(item.name for item in batch.calls)) for batch in scheduler.plan(tuple(call(name) for name in "ABCD"))),
            (("concurrent", ("A", "B")), ("exclusive", ("C",)), ("concurrent", ("D",))),
        )

    async def test_bounded_execution_preserves_barriers_and_result_order(self) -> None:
        active = 0
        peak = 0
        timeline: list[str] = []
        tools = []
        for name, safe, delay in (("A", True, .03), ("B", True, .005), ("C", False, .005), ("D", True, .001)):
            async def run(_input, _progress, _cancelled, current=name, wait=delay):
                nonlocal active, peak
                active += 1
                peak = max(peak, active)
                timeline.append(f"start:{current}")
                await asyncio.sleep(wait)
                timeline.append(f"end:{current}")
                active -= 1
                return current, None

            tools.append(Tool(name, lambda value: value, lambda _value, flag=safe: flag, lambda _value: "allow", run))
        outcomes, _context = await Scheduler(tools, 2).execute(
            tuple(call(name) for name in "ABCD"), asyncio.Event()
        )
        self.assertEqual(peak, 2)
        self.assertGreater(timeline.index("start:C"), timeline.index("end:A"))
        self.assertGreater(timeline.index("start:D"), timeline.index("end:C"))
        self.assertEqual(tuple(outcome.call_id for outcome in outcomes), tuple(f"id-{name}" for name in "ABCD"))

    async def test_parse_failure_precedes_safety_classification(self) -> None:
        classified = False
        executed = False

        def parse(_input):
            raise ValueError("count must be an integer")

        def classify(_input):
            nonlocal classified
            classified = True
            return True

        async def run(_input, _progress, _cancelled):
            nonlocal executed
            executed = True
            return "bad", None

        invalid = Tool("invalid", parse, classify, lambda _value: "allow", run)
        outcomes, _context = await Scheduler((invalid,)).execute((call("invalid"),), asyncio.Event())
        self.assertFalse(classified)
        self.assertFalse(executed)
        self.assertEqual(outcomes[0].status, "error")

    async def test_deny_throw_cancel_keep_exact_pairing(self) -> None:
        cancelled = asyncio.Event()
        denied = Tool("denied", lambda x: x, lambda _x: False, lambda _x: "deny", tool("denied", False).run)

        async def throws(_input, _progress, _cancelled):
            raise RuntimeError("boom")

        async def cancel(_input, _progress, signal):
            signal.set()
            raise RuntimeError("stop")

        tools = (
            denied,
            Tool("throws", lambda x: x, lambda _x: True, lambda _x: "allow", throws),
            Tool("cancel", lambda x: x, lambda _x: True, lambda _x: "allow", cancel),
            tool("later", True),
        )
        calls = tuple(call(name) for name in ("denied", "throws", "cancel", "later"))
        outcomes, _context = await Scheduler(tools, 1).execute(calls, cancelled)
        self.assertEqual(tuple(outcome.status for outcome in outcomes), ("denied", "error", "cancelled", "cancelled"))
        self.assertEqual(len({outcome.call_id for outcome in outcomes}), len(calls))

    async def test_progress_precedes_result_and_context_uses_call_order(self) -> None:
        timeline: list[str] = []
        slow = tool("slow", True, .02, {"winner": "slow"})
        fast_base = tool("fast", True, .001, {"winner": "fast"})

        async def fast_run(values, progress, cancelled):
            progress("half")
            return await fast_base.run(values, progress, cancelled)

        fast = Tool("fast", fast_base.parse, fast_base.is_concurrency_safe, fast_base.permission, fast_run)
        outcomes, context = await Scheduler((slow, fast)).execute(
            (call("slow"), call("fast")), asyncio.Event(),
            lambda call_id, _stage: timeline.append(f"progress:{call_id}"),
        )
        timeline.append(f"result:{outcomes[-1].status}")
        self.assertEqual(timeline, ["progress:id-fast", "result:success"])
        self.assertEqual(context["winner"], "fast")

    def test_snapshot_paths_keep_different_context_modifiers(self) -> None:
        response_complete, streaming = compare_snapshot_policies((
            (True, {"safe": "kept-only-after-response"}),
            (False, {"exclusive": "kept-in-both"}),
        ))
        self.assertEqual(dict(response_complete), {"safe": "kept-only-after-response", "exclusive": "kept-in-both"})
        self.assertEqual(dict(streaming), {"exclusive": "kept-in-both"})


if __name__ == "__main__":
    unittest.main()
