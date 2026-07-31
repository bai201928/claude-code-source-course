from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, replace
from pathlib import Path
from types import MappingProxyType
from typing import Awaitable, Callable, Literal, Mapping, Protocol


@dataclass(frozen=True)
class ProcessRule:
    executable: str
    allowed_argv_prefixes: tuple[tuple[str, ...], ...]


@dataclass(frozen=True)
class ExtensionTrustRule:
    extension_id: str
    source: str
    digest: str | None = None


@dataclass(frozen=True)
class SecurityPolicy:
    revision: int
    require_sandbox: bool
    allowed_worker_ids: tuple[str, ...]
    read_roots: tuple[str, ...]
    write_roots: tuple[str, ...]
    allowed_hosts: tuple[str, ...]
    process_rules: tuple[ProcessRule, ...]
    trusted_extensions: tuple[ExtensionTrustRule, ...]


@dataclass(frozen=True)
class EffectRequest:
    kind: Literal["filesystem", "network", "process"]
    operation: Literal["read", "write", "connect", "spawn"]
    target: str
    argv: tuple[str, ...] = ()


@dataclass(frozen=True)
class ExtensionProvenance:
    extension_id: str
    source: str
    digest: str | None = None


@dataclass(frozen=True)
class ExecutionRequest:
    call_id: str
    worker_id: str
    policy_revision: int
    permission_granted: bool
    effect: EffectRequest
    secret_refs: tuple[str, ...] = ()
    extension: ExtensionProvenance | None = None


@dataclass(frozen=True)
class TrustedExecutionEnvelope:
    call_id: str
    worker_id: str
    policy_revision: int
    effect: EffectRequest
    resolved_secrets: Mapping[str, str]
    extension: ExtensionProvenance | None = None


@dataclass(frozen=True)
class WorkerResult:
    status: Literal["completed"] = "completed"
    output_ref: str | None = None


SecurityReason = Literal[
    "allowed",
    "permission_denied",
    "stale_policy",
    "worker_denied",
    "worker_mismatch",
    "sandbox_unavailable",
    "capability_denied",
    "extension_untrusted",
    "secret_missing",
    "cancelled",
]


@dataclass(frozen=True)
class SecurityReport:
    call_id: str
    decision: Literal["allow", "deny"]
    reason: SecurityReason
    policy_revision: int
    worker_id: str
    capability: Literal["filesystem", "network", "process"]
    secret_ref_ids: tuple[str, ...]
    extension_id: str | None
    sandboxed: bool


@dataclass(frozen=True)
class SecurityExecutionResult:
    ok: bool
    report: SecurityReport
    worker_result: WorkerResult | None = None


class SandboxPort(Protocol):
    worker_id: str

    def is_available(self) -> bool: ...

    async def execute(
        self, envelope: TrustedExecutionEnvelope, signal: "CancellationSignal"
    ) -> WorkerResult: ...


class CancellationSignal:
    def __init__(self) -> None:
        self.cancelled = False
        self.reason = "cancelled"

    def cancel(self, reason: str = "cancelled") -> None:
        self.cancelled = True
        self.reason = reason

    def throw_if_cancelled(self) -> None:
        if self.cancelled:
            raise asyncio.CancelledError(self.reason)


class StalePolicyRevisionError(ValueError):
    pass


class PolicyEngine:
    def __init__(self, initial: SecurityPolicy) -> None:
        self._policy = _validate_policy(initial)

    def snapshot(self) -> SecurityPolicy:
        return self._policy

    def replace(
        self,
        expected_revision: int,
        draft: SecurityPolicy,
    ) -> SecurityPolicy:
        if expected_revision != self._policy.revision:
            raise StalePolicyRevisionError(
                f"stale policy revision {expected_revision}; current={self._policy.revision}"
            )
        self._policy = _validate_policy(
            replace(draft, revision=expected_revision + 1)
        )
        return self._policy


SecretResolver = Callable[[str], str | None | Awaitable[str | None]]


class SecurityExecutor:
    def __init__(
        self,
        policies: PolicyEngine,
        sandbox: SandboxPort,
        secrets: SecretResolver,
    ) -> None:
        self._policies = policies
        self._sandbox = sandbox
        self._secrets = secrets

    async def execute(
        self, request: ExecutionRequest, signal: CancellationSignal
    ) -> SecurityExecutionResult:
        policy = self._policies.snapshot()

        def deny(reason: SecurityReason) -> SecurityExecutionResult:
            return SecurityExecutionResult(False, _report(request, policy, reason))

        if signal.cancelled:
            return deny("cancelled")
        if not request.permission_granted:
            return deny("permission_denied")
        if request.policy_revision != policy.revision:
            return deny("stale_policy")
        if request.worker_id not in policy.allowed_worker_ids:
            return deny("worker_denied")
        if self._sandbox.worker_id != request.worker_id:
            return deny("worker_mismatch")
        if policy.require_sandbox and not self._sandbox.is_available():
            return deny("sandbox_unavailable")
        if not _allows_effect(policy, request.effect):
            return deny("capability_denied")
        if request.extension and not _allows_extension(policy, request.extension):
            return deny("extension_untrusted")

        resolved: dict[str, str] = {}
        for ref in request.secret_refs:
            if signal.cancelled:
                return deny("cancelled")
            value = self._secrets(ref)
            if isinstance(value, Awaitable):
                value = await value
            if signal.cancelled:
                return deny("cancelled")
            if value is None:
                return deny("secret_missing")
            resolved[ref] = value

        if self._policies.snapshot().revision != policy.revision:
            return deny("stale_policy")
        if signal.cancelled:
            return deny("cancelled")
        if policy.require_sandbox and not self._sandbox.is_available():
            return deny("sandbox_unavailable")

        envelope = TrustedExecutionEnvelope(
            request.call_id,
            request.worker_id,
            policy.revision,
            request.effect,
            MappingProxyType(resolved),
            request.extension,
        )
        worker_result = await self._sandbox.execute(envelope, signal)
        return SecurityExecutionResult(
            True, _report(request, policy, "allowed"), worker_result
        )


def _allows_effect(policy: SecurityPolicy, effect: EffectRequest) -> bool:
    if effect.kind == "filesystem":
        roots = policy.read_roots if effect.operation == "read" else policy.write_roots
        return any(_is_within(root, effect.target) for root in roots)
    if effect.kind == "network":
        return any(_host_matches(pattern, effect.target) for pattern in policy.allowed_hosts)
    return any(
        rule.executable == effect.target
        and any(effect.argv[: len(prefix)] == prefix for prefix in rule.allowed_argv_prefixes)
        for rule in policy.process_rules
    )


def _allows_extension(
    policy: SecurityPolicy, extension: ExtensionProvenance
) -> bool:
    return any(
        rule.extension_id == extension.extension_id
        and rule.source == extension.source
        and (rule.digest is None or rule.digest == extension.digest)
        for rule in policy.trusted_extensions
    )


def _is_within(root: str, candidate: str) -> bool:
    try:
        Path(candidate).resolve().relative_to(Path(root).resolve())
        return True
    except ValueError:
        return False


def _host_matches(pattern: str, host: str) -> bool:
    pattern = pattern.lower()
    host = host.lower()
    return host.endswith(pattern[1:]) if pattern.startswith("*.") else host == pattern


def _report(
    request: ExecutionRequest, policy: SecurityPolicy, reason: SecurityReason
) -> SecurityReport:
    return SecurityReport(
        request.call_id,
        "allow" if reason == "allowed" else "deny",
        reason,
        policy.revision,
        request.worker_id,
        request.effect.kind,
        tuple(request.secret_refs),
        request.extension.extension_id if request.extension else None,
        policy.require_sandbox and reason == "allowed",
    )


def _validate_policy(policy: SecurityPolicy) -> SecurityPolicy:
    if policy.revision < 1:
        raise ValueError("policy revision must be positive")
    if not policy.allowed_worker_ids:
        raise ValueError("policy requires at least one worker")
    return policy
