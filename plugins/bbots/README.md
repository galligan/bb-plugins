# Bots

Persistent collaborators for BB, independent of the selected sidebar. The first default collaborator is Bob, with a main conversation named `@Bob`.

**Implementation released on 2026-11-10.** Matt explicitly told bb Bots Builder “Ok go.” The builder is verifying public capabilities in BOTS-3 before scaffolding. This directory currently contains the specification and capability report for `bb-plugin-bbots` (plugin ID `bbots`), not an installable plugin.

## Design documents

- [Product specification](docs/spec.md): experience, scope, configuration, conversations, tasks, and UI.
- [Memory and checkpoints](docs/memory.md): accrual, retrieval, revisions, forgetting, and dreaming.
- [Continuity](docs/continuity.md): compaction, handoffs, routing, model fallback, and lifecycle constraints.
- [Implementation plan](docs/plan.md): work breakdown, acceptance criteria, dependencies, and release gates.
- [Decisions and research](docs/decisions.md): conversation decisions, superseded proposals, reference evidence, and unknowns.
- [Review dispositions](docs/review.md): Fable findings and the resulting corrections.
- [Builder handoff](docs/handoff.md): ownership, release status, environment and next steps.
- [Public capability verification](docs/capabilities.md): current declarations, bounded runtime evidence and open support gates.
- [Native continuity admission gate](docs/sdk-continuity-gates.md): focused reproduction and the required upstream contract investigation.

The dedicated BB Tasks project is **Bots**, prefix **BOTS**, stable project ID `01M73NSQMGEYPWZ30WSR2CEYBP`. It is intentionally not linked in place of the repository's existing BBP tracker. Tasks are the source of implementation intent; keep them and these documents aligned as constraints are verified.
