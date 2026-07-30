from __future__ import annotations

import asyncio
import unittest
from collections.abc import Mapping

from agent_runtime import (
    ActiveRunError,
    AgentRuntime,
    AgentTool,
    CancellationSignal,
    ModelMessage,
    ModelResponse,
    ModelToolCall,
    PermissionGate,
    PermissionRequest,
    RequestProjectionPolicy,
    ScriptedModel,
    ToolContext,
    ToolProgress,
    ToolRegistry,
    TraceRecorder,
)
from conversation_store import (
    ConversationOwnershipError,
    ConversationStore,
    HumanMessage,
    ToolResultMessage,
    envelope_id,
)


def call(call_id: str, name: str, **tool_input: object) -> ModelToolCall:
    return ModelToolCall(call_id, name, tool_input)


def tool(
    name: str,
    execute,
    *,
    risk: str = "read",
    command: str | None = None,
) -> AgentTool:
    return AgentTool(
        name,
        f"{name} test tool",
        {"type": "object"},
        risk,  # type: ignore[arg-type]
        execute,
        lambda _tool_input: PermissionRequest(
            name, risk, command  # type: ignore[arg-type]
        ),
    )


def fixture(
    model: ScriptedModel,
    tools: tuple[AgentTool, ...] = (),
    *,
    max_turns: int = 4,
    gate: PermissionGate | None = None,
    trace: TraceRecorder | None = None,
    request_projection_policy: RequestProjectionPolicy | None = None,
    max_tool_concurrency: int = 4,
) -> tuple[AgentRuntime, ConversationStore, TraceRecorder]:
    registry = ToolRegistry()
    for candidate in tools:
        registry.register(candidate)
    store = ConversationStore()
    recorder = trace or TraceRecorder()
    runtime = AgentRuntime(
        model=model,
        tools=registry,
        permission_gate=gate or PermissionGate(),
        max_turns=max_turns,
        conversation=store,
        trace=recorder,
        request_projection_policy=request_projection_policy,
        max_tool_concurrency=max_tool_concurrency,
    )
    return runtime, store, recorder


def tool_message(request_messages: tuple[ModelMessage, ...], call_id: str) -> ModelMessage:
    return next(
        message
        for message in request_messages
        if message.role == "tool" and message.tool_call_id == call_id
    )


class AgentRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_request_tool_loop_uses_revisioned_conversation(self) -> None:
        async def add(values: Mapping[str, object], _context: ToolContext) -> object:
            return int(values["left"]) + int(values["right"])

        def final(request, _index, _signal):
            self.assertEqual(tool_message(request.messages, "call-1").content, "42")
            return ModelResponse("response-2", "The answer is 42.")

        model = ScriptedModel(
            (
                lambda _request, _index, _signal: ModelResponse(
                    "response-1", tool_calls=(call("call-1", "add", left=20, right=22),)
                ),
                final,
            )
        )
        runtime, store, trace = fixture(model, (tool("add", add),))

        result = await runtime.submit("Calculate 20 + 22", CancellationSignal())

        self.assertEqual((result.status, result.turns), ("completed", 2))
        self.assertEqual(result.final_text, "The answer is 42.")
        self.assertEqual(len(model.requests), 2)
        store.assert_request_ready(store.snapshot())
        self.assertTrue(any(event.event_type == "request.projected" for event in trace.events))
        rendered_trace = repr(trace.events)
        self.assertNotIn("Calculate 20 + 22", rendered_trace)
        self.assertNotIn("The answer is 42.", rendered_trace)
        self.assertNotIn("42'", rendered_trace)

    async def test_request_context_and_tool_preview_do_not_change_durable_history(self) -> None:
        full_output = "sensitive-result-" * 20

        async def inspect(_values, _context):
            return full_output

        def first(request, _index, _signal):
            self.assertIn("workspace=demo", repr(request.messages))
            return ModelResponse(
                "response-1", tool_calls=(call("call-inspect", "inspect"),)
            )

        def final(request, _index, _signal):
            result = tool_message(request.messages, "call-inspect")
            self.assertIn("preview:", result.content or "")
            self.assertNotIn(full_output, result.content or "")
            return ModelResponse("response-2", "done")

        model = ScriptedModel((first, final))
        runtime, store, trace = fixture(
            model,
            (tool("inspect", inspect),),
            request_projection_policy=RequestProjectionPolicy(
                user_context="workspace=demo",
                max_tool_result_chars=32,
                tool_result_preview_chars=8,
            ),
        )

        result = await runtime.submit("inspect", CancellationSignal())

        self.assertEqual(result.status, "completed")
        durable = next(
            message
            for message in store.snapshot().messages
            if isinstance(message, ToolResultMessage)
        )
        self.assertEqual(durable.output, full_output)
        projection_events = [
            event for event in trace.events if event.event_type == "request.projected"
        ]
        self.assertEqual(
            projection_events[-1].attributes["replaced_tool_result_count"], 1
        )
        self.assertIs(
            projection_events[-1].attributes["user_context_injected"], True
        )
        self.assertNotIn("workspace=demo", repr(projection_events))
        self.assertNotIn(full_output, repr(projection_events))

    async def test_permission_denial_is_a_paired_error_result(self) -> None:
        executed = False

        async def dangerous(_values, _context):
            nonlocal executed
            executed = True
            return "must not run"

        def recover(request, _index, _signal):
            result = tool_message(request.messages, "call-denied")
            self.assertIn("no unrestricted grant", result.content or "")
            return ModelResponse("response-2", "Continued without execution.")

        model = ScriptedModel(
            (
                lambda _request, _index, _signal: ModelResponse(
                    "response-1",
                    tool_calls=(call("call-denied", "danger"),),
                ),
                recover,
            )
        )
        runtime, store, trace = fixture(
            model,
            (tool("danger", dangerous, risk="execute", command="danger"),),
        )

        result = await runtime.submit("try", CancellationSignal())

        self.assertEqual(result.status, "completed")
        self.assertFalse(executed)
        paired = [
            message
            for message in store.snapshot().messages
            if isinstance(message, ToolResultMessage)
        ]
        self.assertEqual(len(paired), 1)
        self.assertTrue(paired[0].is_error)
        self.assertTrue(
            any(
                event.event_type == "tool.finished"
                and event.attributes["status"] == "denied"
                for event in trace.events
            )
        )
        store.assert_request_ready(store.snapshot())

    async def test_tool_failure_is_paired_and_the_loop_can_recover(self) -> None:
        async def fail(_values, _context):
            raise RuntimeError("test tool failure")

        def recover(request, _index, _signal):
            self.assertEqual(
                tool_message(request.messages, "call-fail").content,
                "test tool failure",
            )
            return ModelResponse("response-2", "Recovered.")

        model = ScriptedModel(
            (
                lambda _request, _index, _signal: ModelResponse(
                    "response-1", tool_calls=(call("call-fail", "fail"),)
                ),
                recover,
            )
        )
        runtime, store, _trace = fixture(model, (tool("fail", fail),))

        result = await runtime.submit("fail safely", CancellationSignal())

        self.assertEqual(result.status, "completed")
        paired = next(
            message
            for message in store.snapshot().messages
            if isinstance(message, ToolResultMessage)
        )
        self.assertTrue(paired.is_error)
        store.assert_request_ready(store.snapshot())

    async def test_runtime_uses_bounded_safe_batches_and_ordered_publication(self) -> None:
        timeline: list[str] = []
        active = 0
        peak = 0

        def scheduled(name: str, safe: bool, delay: float) -> AgentTool:
            async def execute(_values, context: ToolContext):
                nonlocal active, peak
                timeline.append(f"start:{name}")
                active += 1
                peak = max(peak, active)
                if name == "B":
                    assert context.report_progress is not None
                    await context.report_progress(ToolProgress("half", 1, 2))
                await asyncio.sleep(delay)
                active -= 1
                timeline.append(f"end:{name}")
                return name

            risk = "read" if safe else "execute"
            return AgentTool(
                name,
                name,
                {"type": "object"},
                risk,  # type: ignore[arg-type]
                execute,
                lambda _input: PermissionRequest(
                    name,
                    risk,  # type: ignore[arg-type]
                    None if safe else name,
                ),
                lambda _input: safe,
                lambda _input, _output: {"last_tool": name},
            )

        def final(request, _index, _signal):
            ids = tuple(
                message.tool_call_id
                for message in request.messages
                if message.role == "tool"
            )
            self.assertEqual(ids, ("call-A", "call-B", "call-C", "call-D"))
            return ModelResponse("response-final", "scheduled")

        model = ScriptedModel(
            (
                lambda _request, _index, _signal: ModelResponse(
                    "response-scheduled",
                    tool_calls=tuple(call(f"call-{name}", name) for name in "ABCD"),
                ),
                final,
            )
        )
        runtime, store, trace = fixture(
            model,
            (
                scheduled("A", True, 0.03),
                scheduled("B", True, 0.005),
                scheduled("C", False, 0.005),
                scheduled("D", True, 0.001),
            ),
            gate=PermissionGate(("C",)),
            max_tool_concurrency=2,
        )

        result = await runtime.submit("schedule tools", CancellationSignal())

        self.assertEqual(result.status, "completed")
        self.assertEqual(peak, 2)
        self.assertGreater(timeline.index("start:C"), timeline.index("end:A"))
        self.assertGreater(timeline.index("start:C"), timeline.index("end:B"))
        self.assertGreater(timeline.index("start:D"), timeline.index("end:C"))
        self.assertEqual(runtime.tool_context["last_tool"], "D")
        progress_index = next(
            index for index, event in enumerate(trace.events)
            if event.event_type == "tool.progress"
        )
        finished_index = next(
            index for index, event in enumerate(trace.events)
            if event.event_type == "tool.finished"
            and event.attributes["tool_use_id"] == "call-B"
        )
        self.assertLess(progress_index, finished_index)
        store.assert_request_ready(store.snapshot())

    async def test_cancellation_in_tool_pairs_current_and_remaining_calls(self) -> None:
        signal = CancellationSignal()
        never_executed = False

        async def cancelling(_values, _context):
            signal.cancel("cancelled by test")
            raise RuntimeError("stop")

        async def never(_values, _context):
            nonlocal never_executed
            never_executed = True
            return "unreachable"

        model = ScriptedModel(
            (
                lambda _request, _index, _signal: ModelResponse(
                    "response-1",
                    tool_calls=(
                        call("call-cancel", "cancel"),
                        call("call-never", "never"),
                    ),
                ),
            )
        )
        runtime, store, trace = fixture(
            model, (tool("cancel", cancelling), tool("never", never))
        )

        result = await runtime.submit("cancel", signal)

        self.assertEqual(result.status, "cancelled")
        self.assertFalse(never_executed)
        results = [
            message
            for message in store.snapshot().messages
            if isinstance(message, ToolResultMessage)
        ]
        self.assertEqual(len(results), 2)
        self.assertEqual(results[1].output, "cancelled before execution")
        store.assert_request_ready(store.snapshot())
        self.assertFalse(
            any(
                event.event_type == "tool.started"
                and event.attributes["tool_name"] == "never"
                for event in trace.events
            )
        )

    async def test_cancellation_interrupts_pending_permission_and_pairs_calls(self) -> None:
        signal = CancellationSignal()
        decision_started = asyncio.Event()
        tool_executed = False

        class PendingGate(PermissionGate):
            async def decide(self, _request, observed_signal):
                self.assert_signal(observed_signal)
                decision_started.set()
                await asyncio.Future()

            def assert_signal(self, observed_signal) -> None:
                self_test.assertIs(observed_signal, signal)

        async def never(_values, _context):
            nonlocal tool_executed
            tool_executed = True
            return "unreachable"

        model = ScriptedModel(
            (
                lambda _request, _index, _signal: ModelResponse(
                    "response-1",
                    tool_calls=(
                        call("call-first", "first"),
                        call("call-second", "second"),
                    ),
                ),
            )
        )
        self_test = self
        runtime, store, _trace = fixture(
            model,
            (tool("first", never), tool("second", never)),
            gate=PendingGate(),
        )
        pending = asyncio.create_task(runtime.submit("wait", signal))
        await decision_started.wait()

        signal.cancel("permission cancelled by test")
        result = await asyncio.wait_for(pending, timeout=1)

        self.assertEqual(result.status, "cancelled")
        self.assertFalse(tool_executed)
        results = [
            message
            for message in store.snapshot().messages
            if isinstance(message, ToolResultMessage)
        ]
        self.assertEqual(len(results), 2)
        self.assertIn("permission cancelled by test", results[0].output)
        self.assertEqual(results[1].output, "cancelled before execution")
        store.assert_request_ready(store.snapshot())

    async def test_model_call_cooperatively_observes_cancellation(self) -> None:
        signal = CancellationSignal()
        entered = asyncio.Event()

        async def blocked(_request, _index, observed_signal):
            entered.set()
            await observed_signal.wait()
            observed_signal.throw_if_cancelled()

        model = ScriptedModel((blocked,))
        runtime, _store, _trace = fixture(model)
        pending = asyncio.create_task(runtime.submit("cancel model", signal))
        await entered.wait()

        signal.cancel("model cancelled by test")
        result = await asyncio.wait_for(pending, timeout=1)

        self.assertEqual(result.status, "cancelled")
        self.assertEqual(len(model.requests), 1)

    async def test_max_turns_stops_after_a_complete_paired_iteration(self) -> None:
        async def echo(_values, _context):
            return "ok"

        def scripted(_request, index, _signal):
            return ModelResponse(
                f"response-{index}",
                tool_calls=(call(f"call-{index}", "echo"),),
            )

        model = ScriptedModel((scripted, scripted))
        runtime, store, _trace = fixture(model, (tool("echo", echo),), max_turns=2)

        result = await runtime.submit("keep looping", CancellationSignal())

        self.assertEqual((result.status, result.turns), ("max-turns", 2))
        self.assertEqual(len(model.requests), 2)
        store.assert_request_ready(store.snapshot())

    async def test_second_submit_is_rejected_while_single_flight_is_active(self) -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        async def blocked(_request, _index, _signal):
            entered.set()
            await release.wait()
            return ModelResponse("response-1", "done")

        model = ScriptedModel((blocked,))
        runtime, _store, _trace = fixture(model)
        first = asyncio.create_task(runtime.submit("first", CancellationSignal()))
        await entered.wait()

        with self.assertRaisesRegex(ActiveRunError, "active run"):
            await runtime.submit("second", CancellationSignal())

        release.set()
        self.assertEqual((await first).status, "completed")

    async def test_active_run_lease_rejects_external_conversation_writes(self) -> None:
        entered = asyncio.Event()
        release = asyncio.Event()

        async def blocked(_request, _index, _signal):
            entered.set()
            await release.wait()
            return ModelResponse("response-lease", "done")

        model = ScriptedModel((blocked,))
        runtime, store, _trace = fixture(model)
        pending = asyncio.create_task(runtime.submit("hold lease", CancellationSignal()))
        await entered.wait()

        with self.assertRaisesRegex(ActiveRunError, "run lease"):
            store.append(
                store.revision,
                (HumanMessage("human", envelope_id("external"), "blocked"),),
            )

        release.set()
        self.assertEqual((await pending).status, "completed")

    async def test_second_runtime_cannot_bind_shared_conversation(self) -> None:
        store = ConversationStore()
        first_model = ScriptedModel(
            (lambda _request, _index, _signal: ModelResponse("response-1", "done"),)
        )
        second_model = ScriptedModel(
            (lambda _request, _index, _signal: ModelResponse("response-2", "done"),)
        )
        AgentRuntime(
            model=first_model,
            tools=ToolRegistry(),
            permission_gate=PermissionGate(),
            conversation=store,
        )

        with self.assertRaisesRegex(ConversationOwnershipError, "already bound"):
            AgentRuntime(
                model=second_model,
                tools=ToolRegistry(),
                permission_gate=PermissionGate(),
                conversation=store,
            )

    async def test_content_trace_rejection_does_not_own_the_run(self) -> None:
        trace = TraceRecorder()
        trace.record("run-test", "bad.trace", {"prompt": "must not be written"})
        trace.record("run-test", "bad.tool.trace", {"toolInput": "also rejected"})
        model = ScriptedModel(
            (lambda _request, _index, _signal: ModelResponse("response-1", "done"),)
        )
        runtime, store, _unused_trace = fixture(model, trace=trace)

        result = await runtime.submit("trace stays observational", CancellationSignal())

        self.assertEqual(result.status, "completed")
        self.assertTrue(any("content-bearing" in error for error in trace.errors))
        self.assertFalse(any(event.event_type == "bad.trace" for event in trace.events))
        self.assertFalse(any(event.event_type == "bad.tool.trace" for event in trace.events))
        self.assertTrue(store.snapshot().messages)


if __name__ == "__main__":
    unittest.main()
