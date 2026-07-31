# H7 Production Governance Contract

Status: S5 released with Harness `0.7.0`.

H7 keeps every H0-H6 invariant and closes the portfolio release with three independent control planes: effect security, metadata-only governance and release compatibility. These owners coordinate through explicit immutable inputs; none of them may silently take ownership of conversation, Tool effects or durable work.

## Owners

| Owner | State it may change | State it must not own |
| --- | --- | --- |
| `TranscriptStore` / `RecoveryReducer` / `ResumeCoordinator` | append-only evidence, conservative recovery view and normal/fork orchestration | old processes, remote effect truth or automatic replay |
| `PolicyEngine` / `SecurityExecutor` | policy revision and one fail-closed execution decision | secret storage, OS isolation or Tool result truth |
| `SecretResolver` / `SandboxPort` | trusted-boundary secret resolution and execution of one checked envelope | model request, Permission policy or telemetry |
| `TelemetryRecorder` | closed metadata event delivery and observer failure count | run outcome, prompt or control flow |
| `UsageCostLedger` / `EvaluationLedger` | attempt usage deltas, versioned price/evaluation records | Provider billing truth or execution permission |
| `TenantGovernor` | in-process reservation, queue, concurrency and consumption | distributed quota or organization policy |
| `ReleaseController` | compatible candidate, staged routing, worker drain and rollback revision | infrastructure deployment, Transcript mutation or effect compensation |

## Cumulative invariants

1. Recovery is evidence-driven. Malformed tails, cycles, dangling parents, unresolved tool calls and indeterminate effects produce an explicit partial report; they never justify automatic replay.
2. Normal resume retains session identity. Fork mints new session/message/record identities and does not inherit unresolved effect or background ownership.
3. Permission grant does not replace filesystem, network, process, policy-revision, worker-identity or Sandbox checks. Required-but-unavailable isolation fails closed.
4. Secret values are resolved only at the trusted execution boundary and never enter the model request, policy report, telemetry or release report.
5. Extension provenance must match an exact trusted tuple. A digest is policy evidence, not proof of publisher authenticity.
6. Telemetry uses closed metadata variants. Observer/export failure cannot change run success, protocol pairing, Permission or Tool effects.
7. Provider cumulative usage is converted to attempt-local deltas. Retry/fallback attempts retain separate identity; missing price or TTFT remains `unknown`, never zero.
8. Tenant capacity is reserved before work begins. Active reservations prevent oversubscription; bounded FIFO promotion is local to one tenant and this process.
9. A release candidate must satisfy protocol, readable/write-schema, policy and feature compatibility before a worker can become ready or receive canary traffic.
10. Canary stages advance only from an adequate SLI window. Draining rejects new work while preserving explicit ownership of acquired work.
11. Rollback changes routing and worker admission. It does not erase Transcript evidence, revoke already completed Tool effects or claim automatic compensation.
12. Stable IDs, pending triggers, idempotency keys, fencing and rollback improve recovery control but do not make arbitrary external effects exactly-once.

## Composition boundary

The reference implementation keeps these paths independent:

```text
append-only evidence -> conservative recovery -> new runtime attempt
granted capability -> current policy -> trusted execution envelope -> SandboxPort
runtime metadata -> observer-only telemetry -> usage/evaluation/governance ledgers
release manifest -> compatibility/readiness -> canary/SLO -> drain or rollback
```

Integration into a production system requires adapters for durable databases and queues, effect reconciliation/outbox, real worker or container isolation, secret storage, OpenTelemetry transport, distributed quota reservation, service discovery, traffic routing, schema migration and disaster recovery.

## Honest boundary

Harness `0.7.0` is a tested clean-room reference and portfolio system, not Claude Code private-source parity or a production control plane. Its stores and controllers are in-process and persistence-neutral unless stated otherwise. The Docker/Compose topology is a reproducible reference deployment; it is not proof of kernel isolation, high availability, distributed consensus or successful image execution on a host whose Linux daemon is unavailable.
