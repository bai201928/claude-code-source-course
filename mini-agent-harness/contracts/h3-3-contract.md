# H3-3 Instruction Pipeline Contract

Status: S3 release candidate. This is a clean-room request-instruction contract, not a full CLAUDE.md or Rules parser.

## Ownership

`InstructionCatalog` owns durable in-process source metadata and a monotonic revision. `InstructionPipeline` owns one immutable request snapshot. Dynamic sources are passed to one projection and never published back into the Catalog.

Each source declares:

- stable ID and source kind (`managed`, `user`, `project`, `local`, `dynamic`);
- canonical file path and scope root;
- optional relative path prefixes;
- explicit trust (`trusted`, `approved`, `untrusted`);
- content, which is present only in the projected request snapshot.

## Projection

Projection validates absolute paths, rejects untrusted sources, filters scope/prefix, normalizes paths for dedupe, then orders from managed to user to project to local to dynamic. More nested roots are ordered after broader roots inside the same kind.

The request must call `catalog.assertCurrent(snapshot.catalogRevision)` before Provider use. Publishing a new catalog revision does not mutate an old snapshot; stale writers and stale request snapshots fail explicitly.

## Observability

The projection report contains revision, counts and selected source IDs. It contains no instruction body. Content belongs to the request snapshot, not ordinary Trace.

## Scope boundary

Implemented:

- deterministic source layering;
- explicit trust and approval;
- root/prefix scope;
- normalized-path dedupe;
- immutable snapshots and stale-revision rejection;
- request-only dynamic delta;
- TypeScript/Python behavior parity.

Deferred:

- CLAUDE.md `@include`, Markdown/frontmatter parser and gitignore glob semantics;
- filesystem discovery, symlink policy and managed OS paths;
- nested read triggers and InstructionsLoaded hooks;
- Skill/MCP/Plugin instruction sources;
- persistent/distributed Catalog and content encryption.
