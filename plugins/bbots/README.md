# Bots

Persistent collaborators for BB, independent of the selected sidebar. The first default collaborator is Bob, with a main conversation named `@Bob`.

**Development skeleton:** `bb-plugin-bbots` (plugin ID `bbots`, display Bots) now exposes `bb bot status` and `bb bot status --json`, plus a validated read-only `status` RPC. Use `bb plugin run bbots status` if another plugin owns the `bot` command. Bot creation, storage, SOUL.md, workers and UI follow in separate tasks; they are not implemented by this skeleton.

The headless package builds independently with the published SDK 0.6.132 and declares BB >=0.49.0 / runtime SDK >=0.6.132. It starts no provider work and registers no timers, event handlers, maintenance, retry or transition automation. Native per-thread Stop remains the control; Bots cannot veto another plugin’s actions. Automatic maintenance and continuity remain visibly disabled until each path is implemented and verified.

Matt released implementation and subsequently directed plugin development to proceed using existing public APIs without waiting for upstream changes. BOTS-3 retains specific support limits; BOTS-18 is deferred/non-blocking. No custom production BB build is required or installed. Run `bun run check`, `bun run test` and `bun run build` in this package; root verification includes it.

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
