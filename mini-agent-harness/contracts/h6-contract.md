# H6 Transcript and Recovery Contract

Status: S5 released as part of Harness `0.7.0`.

H6 keeps every H0-H5 invariant and adds a persistence-neutral recovery protocol. It rebuilds a conservative execution view from append-only evidence; it does not claim disk durability, process resurrection or exactly-once external effects.

## Owners

| Owner | State it may change | State it must not own |
| --- | --- | --- |
| `TranscriptStore` | append-only records, record identity and revision | live process, provider request or external effect |
| `RecoveryReducer` | no durable state; message/effect/background projection and metadata report | Transcript mutation or automatic replay |
| `ResumeCoordinator` | one normal/fork orchestration and identity mapping | all domain stores or old runtime handles |
| effect journal | prepared/attempted/committed evidence and idempotency key | remote system truth |
| background journal | attempt lifecycle evidence | old AbortController/process |
| `DurableScheduler` | schedule, stable pending trigger and explicit commit | consumer business effect |

## Invariants

1. A duplicate record ID with identical content is idempotent; a collision fails closed. Distinct records claiming one message ID are reported, not silently overwritten.
2. JSONL decoding keeps valid records, reports malformed middle lines and distinguishes an invalid partial tail.
3. Parent traversal terminates on cycles and dangling parents, returns a partial view and marks `completeChain=false`.
4. Parallel assistant siblings and their tool results are recovered through explicit group/source identity before pairing validation.
5. An assistant record whose every tool use lacks a result is excluded from the resumed request view. Missing result evidence never proves that an external effect did not happen.
6. Effect recovery maps `prepared -> prepared`, `attempted -> indeterminate`, and `committed -> committed`. Indeterminate is reconciled; it is not automatically retried.
7. A non-terminal background attempt is orphaned. Resume creates a new attempt under supervisor policy and never resurrects an old controller or process.
8. Normal resume keeps the session identity. Fork mints session/message/record identities, preserves source mapping and does not copy unresolved effect/background ownership.
9. Scheduler takeover preserves pending trigger IDs and does not commit them. Downstream consumers still need idempotency or an outbox.
10. `RecoveryReport` contains revision, counts, IDs and statuses only; prompt, tool arguments/results and secrets remain outside the observation surface.

## Boundary

H6 is a tested reference state machine. Filesystem/database adapters, fsync/WAL policy, schema registry, transactional outbox, external effect reconciliation, worker processes, durable Compact integration, leader election and distributed fencing remain deferred. Claude Code source facts and this clean-room contract are deliberately distinguished in M24.
