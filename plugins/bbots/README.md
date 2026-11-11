# Bots

Persistent collaborators for BB, independent of the selected sidebar. The first default collaborator is Bob, with a main conversation named `@Bob`.

**Storage foundation:** `bb-plugin-bbots` (plugin ID `bbots`, display Bots) now exposes `bb bot status` and `bb bot status --json`, plus a validated read-only `status` RPC. Use `bb plugin run bbots status` if another plugin owns the `bot` command. The plugin now initializes authoritative SQLite storage for revisioned profiles/documents and stable main-conversation ownership. Public bot creation, home provisioning, session-bound SOUL.md, workers and UI follow in separate tasks; no write commands are exposed yet.

The headless package builds independently with the published SDK 0.6.132 and declares BB >=0.49.0 / runtime SDK >=0.6.132. It starts no provider work and registers no timers, event handlers, maintenance, retry or transition automation. Native per-thread Stop remains the control; Bots cannot veto another plugin’s actions. Automatic maintenance and continuity remain visibly disabled until each path is implemented and verified.

Matt released implementation and subsequently directed plugin development to proceed using existing public APIs without waiting for upstream changes. BOTS-3 retains specific support limits; BOTS-18 is deferred/non-blocking. No custom production BB build is required or installed. Run `bun run check`, `bun run test` and `bun run build` in this package; root verification includes it.

## Storage behavior

Profile creation atomically records its first audit revision and an unbound logical main ID. Name changes preserve those IDs. Document writes (including SOUL.md) use expected per-record revisions; revision zero creates a new document. Stale edits fail instead of overwriting another writer. Revision history records author, reason and time; callers must supply truthful attribution. Markdown is retained verbatim, bounded to 65,536 characters per revision. No live file synchronization or automatic persona rewriting is performed.

Initial physical-thread binding is idempotent and exclusive. It cannot replace an already bound thread; a future verified continuity operation must own that transition. No ownership is inferred from thread titles or metadata. Storage APIs are internal package modules until the creation flow validates public inputs and runtime thread results. Full checkpoints/export remain BOTS-16, and no bot homes or native conversations are created by storage initialization.

The focused suite uses real SQLite, independent connections for stale-write tests, rollback fault injection, SDK reload and a separate Node process reopening committed records. Tests pin better-sqlite3 13.0.3 for its packaged prebuilds under the repository's `--ignore-scripts` install policy; production continues to use the public host-owned database handle.

## Design documents

- [Product specification](docs/spec.md): experience, scope, configuration, conversations, tasks, and UI.
- [Memory and checkpoints](docs/memory.md): accrual, retrieval, revisions, forgetting, and dreaming.
- [Continuity](docs/continuity.md): compaction, handoffs, routing, model fallback, and lifecycle constraints.
- [Implementation plan](docs/plan.md): work breakdown, acceptance criteria, dependencies, and release gates.
- [Decisions and research](docs/decisions.md): conversation decisions, superseded proposals, reference evidence, and unknowns.
- [Review dispositions](docs/review.md): Fable findings and the resulting corrections.
- [Builder handoff](docs/handoff.md): ownership, release status, environment and next steps.
- [Public capability verification](docs/capabilities.md): current declarations, bounded runtime evidence and open support gates.
- [Capability follow-up](docs/capability-followup.md): queue/Stop regressions, native board routing and unmanaged home archive/restart evidence.
- [Native continuity admission gate](docs/sdk-continuity-gates.md): historical reproduction and deferred core prototype, outside the plugin development dependencies.
- [Continuity acceptance matrix](docs/continuity-matrix.md): evidence level, remaining Stop/override/recovery checks and concrete queue compatibility limits.
- [Minimum supported runtime](docs/support-boundary.md): existing manifest gates, distinct SDK/runtime floors and upgrade/rollback requirements.

The dedicated BB Tasks project is **Bots**, prefix **BOTS**, stable project ID `01M73NSQMGEYPWZ30WSR2CEYBP`. It is intentionally not linked in place of the repository's existing BBP tracker. Tasks are the source of implementation intent; keep them and these documents aligned as constraints are verified.
