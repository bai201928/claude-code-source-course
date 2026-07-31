# H7-3 Release Control Plane Contract

Status: S5 released as part of final H7 / Harness `0.7.0`.

H7-3 keeps H0-H7-2 invariants and adds an in-process, revisioned release state machine for compatibility, readiness, staged canary, SLO advancement, worker drain and rollback routing. It is not a Kubernetes controller or database migration service.

## Owners

| Owner | State it may change | State it must not own |
| --- | --- | --- |
| `ReleaseController` | active/candidate/previous release, rollout stage and revision | Tool effects, Transcript contents or infrastructure deployment |
| `ReleaseManifest` | immutable binary/protocol/schema/policy/feature identity | worker health or mutable flags |
| worker state | registration compatibility, readiness, draining and active work count | durable WorkItem/Transcript ownership |
| `SloPolicy` | thresholds used to approve stage advancement | raw prompt/evidence or release routing mutation by itself |

## Invariants

1. A candidate release must overlap the active protocol range, read the active write schema and use an ID distinct from active.
2. The previous release must be able to read candidate writes throughout the rollback window. Schema changes therefore follow expand/read, migrate/write, then contract.
3. A binary canary cannot silently split policy revision. Policy rollout requires an explicit, separately coordinated transition.
4. Worker registration fails closed unless protocol, readable/write schema, policy revision and feature revision match its manifest.
5. Canary begins only when both active and candidate have at least one worker whose required transcript, queue, policy and quota dependencies are ready.
6. Stable routing buckets select candidate traffic only after canary begins and according to the current monotonic stage percentage.
7. Stage advancement requires minimum samples and all success, p95 latency, observer drop and unknown-cost SLO thresholds. A failed window leaves the stage unchanged.
8. A draining worker accepts no new work. Work already acquired remains explicit until `completeWork`; zero active work transitions it to drained.
9. Rollback changes release routing and drains rolled workers. It does not claim to undo Tool effects, delete Transcript records or replay work.
10. Release/worker reports contain IDs, versions, state and counts only. They exclude prompt, tool payload, secret and evidence content.

## Boundary

The controller is process-local and uses caller-supplied stable buckets and SLI windows. Production traffic routing, service discovery, durable rollout state, distributed revision CAS, Kubernetes reconciliation, queue lease takeover, database migration, feature flag delivery, automatic compensation, backup/restore and disaster recovery remain adapter and platform responsibilities.
