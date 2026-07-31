# H7-1 Security Boundary Contract

Status: S5 released as part of Harness `0.7.0`.

H7-1 keeps H0-H6 invariants and adds a fail-closed control plane between a granted capability and its external effect. It is a port-level reference implementation, not an OS Sandbox.

## Owners

| Owner | State it may change | State it must not own |
| --- | --- | --- |
| `PolicyEngine` | immutable policy snapshot and monotonic revision | worker process, secret value or effect result |
| `SecurityExecutor` | one authorization/execution orchestration | policy source, durable secret store or OS isolation |
| `SecretResolver` | lookup at trusted execution boundary | model request or telemetry report |
| `SandboxPort` | execution of one checked envelope | Permission decision or policy mutation |
| extension trust policy | exact accepted provenance tuples | publisher authenticity it did not verify |

## Invariants

1. `ExecutionRequest` carries a policy revision and worker identity. A stale revision, denied worker or port/worker mismatch fails before effect.
2. Permission grant is necessary but not sufficient. Filesystem, network and process argv constraints remain independent fail-closed checks.
3. If policy requires Sandbox and the port is unavailable, execution does not fall back to an unsandboxed worker.
4. Secret values never enter the model/control-plane request or `SecurityReport`. Only a trusted-boundary envelope receives resolved values.
5. Missing secrets fail closed. Policy revision is checked again after asynchronous resolution so a refresh cannot silently authorize under stale policy.
6. Extension provenance must exactly match a trusted rule. Unknown source/digest is denied; a digest match is policy evidence, not signature verification.
7. Cancellation observed before the effect prevents the worker call.
8. `SecurityReport` contains IDs, revision, decision, reason and capability kind only. It excludes effect target, argv, payload, output and secret values.

## Boundary

The current `SandboxPort` is tested with a deterministic fake. OS process/container isolation, native Windows Sandbox, kernel-level network/filesystem enforcement, complete TOCTOU elimination, PKI/signature verification, universal subprocess secret scrubbing and distributed policy delivery remain deferred. Production adapters must enforce the same envelope at a real process boundary.
