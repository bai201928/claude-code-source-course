from __future__ import annotations

import unittest

from agent_runtime import (
    AgentTool,
    CancellationSignal,
    OperationCancelled,
    PermissionDecision,
    PermissionGate,
    PermissionRequest,
    ToolContext,
    ToolRegistry,
)
from extension_decision import (
    DecisionContext,
    ExtensionDecisionPipeline,
    PreHookResult,
    Resolution,
)


class DenyGate(PermissionGate):
    def decide(self, request, signal):
        return PermissionDecision(False, "policy-deny")


class CancellingGate(PermissionGate):
    def decide(self, request, signal):
        signal.cancel("cancelled after allow")
        return PermissionDecision(True, "policy-allow")


class ExtensionDecisionTests(unittest.IsolatedAsyncioTestCase):
    async def test_hook_allow_does_not_override_policy_deny(self) -> None:
        pipeline = ExtensionDecisionPipeline(
            pre_hooks=(("advisory", lambda _context, _signal: PreHookResult("allow")),)
        )
        prepared = await prepare(pipeline, DenyGate())
        self.assertFalse(prepared.decision.allowed)
        self.assertEqual(
            tuple((item.stage, item.behavior) for item in prepared.evidence),
            (("pre-hook", "allow"), ("policy", "deny")),
        )

    async def test_rewrite_is_revalidated_before_handler(self) -> None:
        calls = 0

        def rewrite(_context, _signal):
            return PreHookResult(updated_input={"count": 0})

        async def execute(_input, _context):
            nonlocal calls
            calls += 1
            return "side-effect"

        registry = registry_with(
            ExtensionDecisionPipeline(pre_hooks=(("rewrite", rewrite),)), execute
        )
        with self.assertRaisesRegex(ValueError, "count must be positive"):
            await registry.dispatch(
                "demo",
                {"count": 2},
                ToolContext(CancellationSignal()),
                PermissionGate(),
                "call-1",
            )
        self.assertEqual(calls, 0)

    async def test_final_cancel_gate_blocks_side_effect(self) -> None:
        calls = 0

        async def execute(_input, _context):
            nonlocal calls
            calls += 1
            return "bad"

        registry = registry_with(ExtensionDecisionPipeline(), execute)
        with self.assertRaisesRegex(OperationCancelled, "cancelled after allow"):
            await registry.dispatch(
                "demo",
                {"count": 2},
                ToolContext(CancellationSignal()),
                CancellingGate(),
                "call-2",
            )
        self.assertEqual(calls, 0)

    async def test_post_hook_stops_continuation_after_side_effect(self) -> None:
        calls = 0

        async def execute(_input, _context):
            nonlocal calls
            calls += 1
            return "done"

        pipeline = ExtensionDecisionPipeline(
            post_hooks=(("stop-after", lambda _context, _succeeded, _signal: True),)
        )
        result = await registry_with(pipeline, execute).dispatch(
            "demo",
            {"count": 2},
            ToolContext(CancellationSignal()),
            PermissionGate(),
            "call-3",
        )
        self.assertEqual(calls, 1)
        self.assertEqual(result.output, "done")
        self.assertFalse(result.continue_conversation)

    async def test_headless_ask_without_resolver_and_resolver_error_fail_closed(self) -> None:
        async def broken_resolver(_context, _evidence, _signal):
            raise RuntimeError("unavailable")

        for pipeline in (
            ExtensionDecisionPipeline(
                pre_hooks=(("ask", lambda _context, _signal: PreHookResult("ask")),)
            ),
            ExtensionDecisionPipeline(
                pre_hooks=(("ask", lambda _context, _signal: PreHookResult("ask")),),
                ask_resolver=broken_resolver,
            ),
        ):
            prepared = await prepare(pipeline, PermissionGate())
            self.assertFalse(prepared.decision.allowed)

    async def test_evidence_contains_metadata_only(self) -> None:
        pipeline = ExtensionDecisionPipeline(
            pre_hooks=((
                "rewrite",
                lambda _context, _signal: PreHookResult(
                    "allow", {"count": 3, "secret": "input-secret"}
                ),
            ),)
        )
        prepared = await prepare(pipeline, PermissionGate())
        serialized = repr(prepared.evidence)
        self.assertNotIn("secret", serialized)
        self.assertNotIn("input-secret", serialized)

    async def test_resolver_rewrite_revalidates_and_reruns_policy(self) -> None:
        policy_calls = 0

        def resolver(_context, _evidence, _signal):
            return Resolution(True, "human-approved", {"count": 4})

        pipeline = ExtensionDecisionPipeline(
            pre_hooks=(("ask", lambda _context, _signal: PreHookResult("ask")),),
            ask_resolver=resolver,
        )
        signal = CancellationSignal()

        def policy(_candidate):
            nonlocal policy_calls
            policy_calls += 1
            return PermissionDecision(
                True, "content-bearing-reason-must-not-enter-evidence"
            )

        prepared = await pipeline.prepare(
            call_id="call",
            tool_name="demo",
            tool_input={"count": 2},
            validate_schema=lambda _input: None,
            validate_semantics=validate_semantics,
            decide_policy=policy,
            signal=signal,
        )
        self.assertEqual(prepared.context.revision, 1)
        self.assertEqual(prepared.context.input["count"], 4)
        self.assertEqual(policy_calls, 2)
        self.assertNotIn("content-bearing", repr(prepared.evidence))


async def prepare(pipeline: ExtensionDecisionPipeline, gate: PermissionGate):
    signal = CancellationSignal()
    return await pipeline.prepare(
        call_id="call",
        tool_name="demo",
        tool_input={"count": 2},
        validate_schema=lambda _input: None,
        validate_semantics=validate_semantics,
        decide_policy=lambda candidate: gate.decide(
            PermissionRequest("demo", "read"), signal
        ),
        signal=signal,
    )


def validate_semantics(tool_input) -> None:
    if tool_input.get("count", 0) <= 0:
        raise ValueError("count must be positive")


def registry_with(pipeline: ExtensionDecisionPipeline, execute) -> ToolRegistry:
    registry = ToolRegistry(pipeline)
    registry.register(
        AgentTool(
            "demo",
            "test tool",
            {
                "type": "object",
                "properties": {
                    "count": {"type": "integer"},
                    "secret": {"type": "string"},
                },
                "required": ["count"],
                "additionalProperties": False,
            },
            "read",
            execute,
            lambda _input: PermissionRequest("demo", "read"),
            validate_input=validate_semantics,
        )
    )
    return registry


if __name__ == "__main__":
    unittest.main()
