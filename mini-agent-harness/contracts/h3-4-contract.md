# H3-4 Memory Contract

Status: S3 released. This is a clean-room memory lifecycle and recall contract, not a claim that Claude Code implements the same candidate state machine.

## Ownership

`MemoryStore` owns candidates, accepted records, scope, provenance, retention and a monotonic revision. `MemoryProjector` owns one read-only recall view. Neither component owns durable conversation messages, Compact journal records or instruction sources.

The lifecycle is:

```text
candidate -> accepted -> superseded
          -> rejected
accepted  -> expired
```

Only accepted, non-expired records can enter recall. A candidate is an observation awaiting an explicit decision, not a durable fact.

## Revision and transition boundary

- `propose`, `transition`, `updateAccepted` and `expire` validate the caller's expected revision before mutation.
- A stale writer fails explicitly and cannot overwrite a newer acceptance or update.
- Duplicate active records with the same scope and key merge into the existing record instead of creating a second candidate.
- Superseding requires a distinct replacement whose status is candidate or accepted.
- Updating content is allowed only after acceptance and must publish new provenance.

## Scope, retention and recall

- Scope is structured as `project` or `session` plus a stable key; recall requires an exact scope match.
- An accepted record may have a retention duration. Once its deadline is reached, `expire` changes its lifecycle state and recall excludes it.
- Recall uses deterministic relevance, update time and ID ordering, plus explicit item and character budgets.
- `MemoryProjector` formats only the bounded recall view. It does not append memory content to `ConversationStore` or publish it into `InstructionCatalog`.

## Observability

Memory Trace records only operation, outcome, store revision, memory IDs, scope and a safe failure reason. It never records memory content or source material. Model-visible projected content travels through the request view, not ordinary telemetry.

## Separation from Claude Code facts

The verified Claude Code snapshot has Session Memory, Auto Memory topic/index files, relevance attachments and Auto Dream, but no unified candidate/accepted store, retention CAS or transactional multi-file memory commit. H3-4 imports the ownership and governance lessons; it does not present this state machine as private-source parity.

## Verification

TypeScript and Python both prove:

- candidate-before-accept is not recallable;
- project/session scope isolation;
- active duplicate merge;
- stale revision rejection;
- retention expiry;
- bounded deterministic recall;
- content-free Trace;
- accepted-to-superseded lifecycle.

## Deferred

- durable database or filesystem storage;
- encryption, PII/DLP and redaction policy enforcement;
- embeddings/vector search and learned ranking;
- distributed writers, tenant federation and team sync;
- Auto Dream, Transcript reduction and resume reconstruction.
