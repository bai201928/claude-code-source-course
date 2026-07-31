# H7-2 Observability and Governance Contract

Status: S5 released as part of Harness `0.7.0`.

H7-2 keeps H0-H7-1 invariants and adds metadata-only telemetry, attempt-scoped usage/cost accounting, versioned evaluation records and tenant admission control. It is an in-process reference control plane, not a production OpenTelemetry or distributed quota service.

## Owners

| Owner | State it may change | State it must not own |
| --- | --- | --- |
| `TelemetryRecorder` | observer delivery failure count | run outcome, prompt, tool payload or execution state |
| `UsageCostLedger` | immutable attempt usage deltas and price/TTFT status | provider billing truth or request retry decision |
| `EvaluationLedger` | versioned metadata outcomes keyed by event ID | execution permission or generic truth about an answer |
| `TenantGovernor` | in-process reservation, queue, concurrency and window consumption | Provider quota header, organization feature policy or model task budget |

## Invariants

1. Telemetry uses closed event variants. It carries correlation IDs, counters, timing and categorical outcomes, not prompt, message, tool input/result or secret values.
2. An `OpenTelemetryPort` is observer-only. Export failure increments a metadata counter and does not change run success, message pairing or tool effects.
3. Provider streaming usage enters as an attempt-local cumulative snapshot. The ledger subtracts the previous snapshot, so `100 -> 130` contributes `30`, not `130` again.
4. Retry and fallback attempts have distinct identity. Reusing one event ID with identical input is idempotent; reusing it with different input fails as a collision.
5. Each cost entry binds a non-empty price version. Missing price produces `unknown`, never zero cost. Missing TTFT remains `unknown`, never `0 ms`.
6. Evaluation records bind rubric and evaluator versions. They contain numeric/categorical outcome metadata and cannot block execution by throwing from an observer.
7. Tenant admission reserves token estimate, cost estimate and one concurrency slot before work starts. Active reservations count against capacity, preventing concurrent oversubscription.
8. Queue capacity is bounded per tenant and promotion is FIFO within that tenant. Completion commits actual consumption and releases concurrency; cancellation releases without consumption.
9. Governance reports contain only tenant ID, counts and numeric totals. They exclude request content and credentials.

## Boundary

The current ledger and governor are process-local. Exact Provider billing, currency settlement, durable event transport, production OpenTelemetry SDK wiring, distributed atomic quota reservation, rolling-window storage, cross-node fairness and a universal evaluation model remain deferred. Provider quota headers, organization feature policy, request `task_budget` hints and this tenant governor remain distinct control planes.
