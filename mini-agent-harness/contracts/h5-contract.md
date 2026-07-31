# H5 Work Coordination Contract

Status: S4 released with Harness `0.5.0`.

H5 keeps every H0-H4 invariant and adds a portfolio-scale coordination control plane. Runtime execution, durable responsibility, team identity, message delivery and scheduled trigger state remain separate owners.

## Owners

| Owner | State it may change | State it must not own |
| --- | --- | --- |
| `WorkItemStore` | blockers, work status, revision, lease/heartbeat/reclaim/fencing | AbortController, process output, mailbox delivery |
| `RuntimeExecutionRegistry` | live attempt, foreground/background mode, linked/detached cancellation and terminal execution state | Work-item completion or lease truth |
| `TeamDirectory` | team/member identity and member lifecycle | conversation, work payload or delivery acknowledgment |
| `AcknowledgedMailbox` | message identity, recipient sequence, delivery count and explicit ack | recipient business side effect |
| `ShutdownCoordinator` | correlated request/approve/reject/complete state | physical process-tree termination proof |
| `DurableScheduler` | schedule, stable pending trigger and commit/recovery state | external side effect or exactly-once guarantee |

## Invariants

1. Work-item status and Runtime execution status are distinct state machines linked by IDs, not one shared `Task.status`.
2. Claim requires completed blockers and an expected revision. A live lease fences another claimant.
3. Heartbeat extends only the current token. Expiry returns the item to pending; a stale token cannot heartbeat, complete or release reclaimed work.
4. Linked execution follows parent cancellation. Detached execution owns an independent controller and must retain an explicit supervisor stop path.
5. Team/member IDs are stable within one directory revision. Shutdown is a correlated protocol; rejection leaves the member active, approval moves it through stopping to stopped.
6. Mailbox message IDs deduplicate retries, recipient sequence gives one recipient a stable delivery order, unacknowledged messages redeliver, and only the recipient may acknowledge.
7. Ack is not the business effect. Consumers still need an idempotency ledger or a transaction joining effect and acknowledgment.
8. Scheduler polling creates a stable pending trigger before commit. Recovery redelivers the same trigger ID; one-shot removal or recurring advance occurs only on commit.
9. A stable trigger and idempotency key support deduplication but do not make an arbitrary external API exactly-once.
10. Coordination trace contains type, entity ID, status, revision and counts only; work descriptions, mailbox payloads and tool results stay out.

## H6 foundation and boundary

`DurableScheduler` is the first H6 foundation because it exposes exportable recovery state and a stable pending trigger. S4 does not release full H6: `TranscriptStore`, `RecoveryReducer`, `ResumeCoordinator`, durable Compact reconciliation, process-backed Subagents, database CAS, queue/outbox adapters, scheduler leader election and distributed fencing remain for later work.

All H5 stores are in-process, persistence-neutral reference implementations. They demonstrate contracts and failure semantics; they are not production durability, cluster consensus, process isolation or Claude Code private-source parity.
