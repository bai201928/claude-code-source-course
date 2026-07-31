# H3-2 Compact Transaction Contract

Status: S3 release candidate. This is a clean-room Harness contract derived from M17 experiments; it is not a claim that the Harness reproduces every Claude Code compaction side effect.

## Purpose

H3-2 lets the runtime replace an oversized durable conversation with a compact boundary, a generated summary and a protocol-valid retained tail without allowing cancellation or a stale writer to silently corrupt the message owner.

## Ownership and ordering

`AgentRuntime` remains the single-flight owner. `CompactCoordinator` may prepare a plan from an immutable `ConversationSnapshot`, but only the runtime-held `ConversationRunLease` may commit it.

The local transaction order is:

```text
snapshot expected revision
-> summarize selected prefix
-> validate replacement and provenance
-> append prepared journal record
-> cancellation and revision check
-> append committed journal record
-> ConversationStore.replace(expectedRevision)
-> metadata-only committed Trace
```

There is no `await` between the final revision check, committed record and Store replacement. A future persistent journal must preserve that single-writer boundary or provide a stronger atomic storage primitive.

## Preserved invariants

- Leading system messages remain leading system messages.
- The compact boundary and summary are explicit system envelopes with fresh IDs.
- The retained suffix expands backward until every assistant tool-use has its immediately following results.
- Every replacement is validated by a new `ConversationStore` and `assertRequestReady` before commit.
- Parent links are rebased into one valid local chain; old parent links are not treated as durable recovery provenance.
- Summary, message bodies and tool outputs never enter Trace attributes.
- The commit advances the durable owner by exactly one revision.

## Cancellation and stale writers

- Cancellation before or after summary generation leaves both owner and journal unchanged.
- Cancellation after the prepared record leaves the original owner intact; recovery selects the journal's original history with `fell_back / prepared_only`.
- A changed Store revision rejects the plan before any journal mutation.
- An active submit and an active compact are mutually exclusive through the same run lease.

## Recovery states

Recovery consumes the latest record only and returns content separately from a content-free report:

- `restored`: a committed record has a valid boundary, summary, source provenance and retained IDs.
- `fell_back`: no record exists or the latest record is prepared-only.
- `repair_required`: the committed record is malformed or misses its boundary or summary.

The in-memory journal demonstrates the state machine but is not crash durability. Filesystem framing, flush/fsync, record checksums, multi-process locking and transcript reconciliation remain deferred to the transcript milestone.

## Verification

TypeScript and Python each cover:

- Runtime integration and one-revision commit;
- summary cancellation;
- cancellation after prepared;
- stale-plan rejection;
- tool-pair-aware retained-tail expansion;
- metadata-only Trace.

The separate M17 experiments additionally exercise complete recovery, boundary-only, summary-only and malformed-provenance records.
