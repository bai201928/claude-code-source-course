# H3 Context and Memory Contract

Status: S3 released with Harness `0.4.0`.

H3 combines four independently owned increments. H2 and all earlier contracts remain in force.

| Increment | Owner | Published capability |
| --- | --- | --- |
| H3-1 | `ResultBudgetLedger` / `RequestProjector` | aggregate tool-result budgeting, exact replacement replay and strict post-projection validation |
| H3-2 | `CompactCoordinator` / `CompactJournal` | revision-checked compact prepare/commit/recovery and tool-pair-safe retained tail |
| H3-3 | `InstructionCatalog` / `InstructionPipeline` | scoped, trusted, revisioned instruction snapshots and request-only dynamic sources |
| H3-4 | `MemoryStore` / `MemoryProjector` | candidate lifecycle, scope/provenance, retention and bounded accepted-memory recall |

## Composition rule

```text
ConversationStore snapshot
  + ResultBudgetLedger snapshot
  + InstructionCatalog snapshot
  + accepted Memory recall view
  -> one immutable model request
```

These revisions do not collapse into one global counter. Conversation facts, compact transactions, replacement decisions, instruction sources and accepted memories have different writers, failure semantics and recovery policies.

## H3 invariants

1. Request optimization never mutates complete durable tool output.
2. Compact replaces history only through the runtime-owned lease and expected conversation revision.
3. Dynamic instructions and recalled memories are request views, not durable conversation appends.
4. Candidate memory cannot become model-visible until explicit acceptance.
5. Scope and trust checks occur before content projection.
6. Every projection is bounded and followed by protocol validation where message pairing can change.
7. Trace and reports contain IDs, revisions, counts and status, never prompt, instruction, memory or tool-result bodies.
8. A stale writer fails closed at its own owner boundary instead of overwriting another subsystem.

Detailed rules remain in `h3-1-contract.md`, `h3-2-contract.md`, `h3-3-contract.md` and `h3-4-contract.md`.

## Milestone boundary

H3 does not claim crash-durable Transcript resume, persistent Compact journal, external tool-result storage, Provider-specific SSE integration, full CLAUDE.md discovery, Hook/Skill/MCP/Plugin, vector memory, PII/DLP enforcement, Sandbox or distributed execution. Those capabilities belong to later milestones.
