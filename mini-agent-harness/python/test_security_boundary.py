import asyncio
import json
import os
import unittest
from dataclasses import asdict, replace
from pathlib import Path

from security_boundary import (
    CancellationSignal,
    EffectRequest,
    ExecutionRequest,
    ExtensionProvenance,
    ExtensionTrustRule,
    PolicyEngine,
    ProcessRule,
    SecurityExecutor,
    SecurityPolicy,
    StalePolicyRevisionError,
    TrustedExecutionEnvelope,
    WorkerResult,
)


WORKSPACE = str(Path("security-fixture").resolve())


def policy():
    return SecurityPolicy(
        revision=1,
        require_sandbox=True,
        allowed_worker_ids=("worker-1",),
        read_roots=(WORKSPACE,),
        write_roots=(WORKSPACE,),
        allowed_hosts=("api.example.com",),
        process_rules=(ProcessRule("git", (("status",), ("diff",))),),
        trusted_extensions=(
            ExtensionTrustRule("reviewer", "corp-market", "sha256:known"),
        ),
    )


def request(**changes):
    base = ExecutionRequest(
        "call-1",
        "worker-1",
        1,
        True,
        EffectRequest("filesystem", "read", os.path.join(WORKSPACE, "input.txt")),
    )
    return replace(base, **changes)


class FakeSandbox:
    def __init__(self, worker_id="worker-1"):
        self.worker_id = worker_id
        self.available = True
        self.calls: list[TrustedExecutionEnvelope] = []

    def is_available(self):
        return self.available

    async def execute(self, envelope, signal):
        signal.throw_if_cancelled()
        self.calls.append(envelope)
        return WorkerResult(output_ref="artifact://result")


class SecurityBoundaryTests(unittest.IsolatedAsyncioTestCase):
    def test_policy_revision(self):
        engine = PolicyEngine(policy())
        self.assertEqual(engine.replace(1, replace(policy(), require_sandbox=False)).revision, 2)
        with self.assertRaises(StalePolicyRevisionError):
            engine.replace(1, policy())

    async def test_stale_request(self):
        sandbox = FakeSandbox()
        engine = PolicyEngine(policy())
        engine.replace(1, policy())
        result = await SecurityExecutor(engine, sandbox, lambda _: None).execute(
            request(), CancellationSignal()
        )
        self.assertEqual(result.report.reason, "stale_policy")
        self.assertEqual(sandbox.calls, [])

    async def test_permission_cannot_bypass_filesystem_policy(self):
        sandbox = FakeSandbox()
        result = await SecurityExecutor(PolicyEngine(policy()), sandbox, lambda _: None).execute(
            request(effect=EffectRequest("filesystem", "write", str(Path("outside.txt").resolve()))),
            CancellationSignal(),
        )
        self.assertEqual(result.report.reason, "capability_denied")
        self.assertEqual(sandbox.calls, [])

    async def test_required_sandbox_unavailable(self):
        sandbox = FakeSandbox()
        sandbox.available = False
        result = await SecurityExecutor(PolicyEngine(policy()), sandbox, lambda _: None).execute(
            request(), CancellationSignal()
        )
        self.assertEqual(result.report.reason, "sandbox_unavailable")

    async def test_network_and_process_constraints(self):
        sandbox = FakeSandbox()
        executor = SecurityExecutor(PolicyEngine(policy()), sandbox, lambda _: None)
        network = await executor.execute(
            request(effect=EffectRequest("network", "connect", "evil.example")), CancellationSignal()
        )
        process = await executor.execute(
            request(effect=EffectRequest("process", "spawn", "git", ("-c", "evil", "status"))),
            CancellationSignal(),
        )
        self.assertEqual(network.report.reason, "capability_denied")
        self.assertEqual(process.report.reason, "capability_denied")

    async def test_secret_only_reaches_trusted_envelope(self):
        sandbox = FakeSandbox()
        req = request(secret_refs=("provider-key",))
        result = await SecurityExecutor(
            PolicyEngine(policy()), sandbox, lambda _: "highly-sensitive-value"
        ).execute(req, CancellationSignal())
        self.assertTrue(result.ok)
        self.assertEqual(sandbox.calls[0].resolved_secrets["provider-key"], "highly-sensitive-value")
        self.assertNotIn("highly-sensitive-value", json.dumps(asdict(req)))
        self.assertNotIn("highly-sensitive-value", repr(result.report))

    async def test_missing_secret(self):
        sandbox = FakeSandbox()
        result = await SecurityExecutor(PolicyEngine(policy()), sandbox, lambda _: None).execute(
            request(secret_refs=("missing",)), CancellationSignal()
        )
        self.assertEqual(result.report.reason, "secret_missing")
        self.assertEqual(sandbox.calls, [])

    async def test_policy_refresh_during_secret_resolution(self):
        sandbox = FakeSandbox()
        engine = PolicyEngine(policy())

        async def resolve(_):
            engine.replace(1, policy())
            await asyncio.sleep(0)
            return "resolved-at-boundary"

        result = await SecurityExecutor(engine, sandbox, resolve).execute(
            request(secret_refs=("provider-key",)), CancellationSignal()
        )
        self.assertEqual(result.report.reason, "stale_policy")
        self.assertEqual(sandbox.calls, [])

    async def test_extension_provenance(self):
        sandbox = FakeSandbox()
        executor = SecurityExecutor(PolicyEngine(policy()), sandbox, lambda _: None)
        denied = await executor.execute(
            request(extension=ExtensionProvenance("reviewer", "public-market", "sha256:known")),
            CancellationSignal(),
        )
        allowed = await executor.execute(
            request(extension=ExtensionProvenance("reviewer", "corp-market", "sha256:known")),
            CancellationSignal(),
        )
        self.assertEqual(denied.report.reason, "extension_untrusted")
        self.assertTrue(allowed.ok)
        self.assertEqual(len(sandbox.calls), 1)

    async def test_cancel_before_effect(self):
        sandbox = FakeSandbox()
        signal = CancellationSignal()
        signal.cancel("stop")
        result = await SecurityExecutor(PolicyEngine(policy()), sandbox, lambda _: None).execute(
            request(), signal
        )
        self.assertEqual(result.report.reason, "cancelled")
        self.assertEqual(sandbox.calls, [])


if __name__ == "__main__":
    unittest.main()
