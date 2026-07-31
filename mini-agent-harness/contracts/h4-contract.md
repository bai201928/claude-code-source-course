# H4 Extension Governance Contract

Status: released as part of S4 / Harness `0.5.0`.

H4 keeps every H0-H3 invariant and adds three independently owned extension boundaries.

| Increment | Owner | Contract |
| --- | --- | --- |
| H4-1 | `ExtensionDecisionPipeline` | ordered pre/post hooks, immutable input revisions, rewrite revalidation, policy monotonicity and a final cancellation gate |
| H4-2 | `ExtensionRegistry` | full source identity, trust policy, atomic conflict rejection, immutable revisioned snapshots and execution leases |
| H4-3 | `McpSession` | transport-neutral handshake, generation/revision, qualified capability snapshots, fail-closed refresh and explicit retry policy |

## Invariants

1. A Hook can narrow or rewrite a request, but cannot turn a policy denial into an allow.
2. Every rewrite is schema- and semantic-revalidated, then sent through policy again before side effects start.
3. A final `AbortSignal` check occurs after authorization and before the handler; post hooks may stop continuation but cannot roll back an effect.
4. Decision evidence contains IDs, revisions, behaviors and counts, never tool input, prompt, output or permission reason text.
5. Extension identity includes marketplace, locator, plugin and version; namespace is only a model-visible collision boundary.
6. Publication is expected-revision and all-or-nothing. Conflicts never partially change the active snapshot.
7. Unload prevents new acquisition from an old snapshot. An already acquired lease remains valid until cooperative release.
8. MCP connection, initialization/list success and request-ready capability publication are different states.
9. MCP tool names are server-qualified. A list-change refresh publishes a new revision; failure degrades the session instead of serving stale tools to new calls.
10. Local cancellation does not claim remote rollback. Session loss is indeterminate unless an explicit policy approves one recovery attempt with the same idempotency key.

## Integration boundary

H4-1 is integrated into `AgentToolRegistry`, `ToolScheduler` and `AgentRuntime`. H4-2 and H4-3 are tested control-plane components with adapters to capability definitions, but are not hidden mutable globals and are not automatically wired into every runtime request.

H4 does not implement filesystem Skill/Plugin discovery, marketplace fetch, signature verification infrastructure, official MCP transports/OAuth, Resource/Prompt adapters, Sandbox, distributed policy, durable approval queues or remote exactly-once effects. Production MCP transports must use an official SDK rather than a hand-written wire protocol.
