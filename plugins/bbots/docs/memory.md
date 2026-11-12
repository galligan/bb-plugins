# Memory, revisions, and dreaming

## Storage decision

Use one authoritative SQLite store for bot configuration, Markdown documents, memory records, revisions, checkpoints, and operational references. Markdown and JSON exports provide portability. SQLite revisions supersede the earlier idea of Git-authoritative live files; do not build bidirectional file/database synchronization or automatic Git commits in v1.

Keep the model small. Candidate records below express required semantics, not a frozen schema. Start with topic lookup and text search; no vector store, knowledge graph, or elaborate taxonomy without measured need.

| Record                  | Minimum meaning                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Bot configuration       | Stable bot ID, display identity, execution/home/project/task choices and revision                                              |
| Document                | Stable ID, bot ID, kind/name (including SOUL.md), summary, Markdown details, current revision                                  |
| Memory revision         | Content, source references, author, timestamp, change reason, fact/inference distinction, supersession/forgetting state        |
| Checkpoint              | Named immutable selection of configuration/soul/memory revisions, with author/time/reason                                      |
| Commitment              | Current obligation and owner, authoritative task-source reference, progress evidence; separate from durable personal knowledge |
| Conversation/transition | Logical conversation identity, physical thread mappings, assignment/report contract and resumable cutover state                |
| Consolidation progress  | Source range processed, run state, resulting revision IDs, bounded failure information                                         |

Source references point to original threads/messages/artifacts where possible, not merely another summary. Exports preserve schema version, stable IDs, revisions, and relationships; resolve local host references explicitly. Credentials, tokens, provider sessions, and transient downloads do not belong in portable profile exports. Import and conflict-merging are deferred in v1. Exports are inspectable portable records, not a verified full operational recovery mechanism. Document consistent SQLite backup/restore using the owning storage contract separately; do not promise that copying a live database without its required journal state is safe.

## What to retain

Separate enduring knowledge (preferences, people, recurring responsibilities, project facts), active work (commitments, unresolved decisions, reporting contracts), and historical evidence (conversations, findings, artifacts). Do not turn temporary test failures or intermediate hypotheses into permanent facts. Completed work leaves the active set but retains history.

Explicit remember/correction requests apply promptly. Useful ordinary observations can accrue under the bot's memory policy without asking about every preference. Mark inference separately from explicit user statements; one detailed-report request does not establish a universal preference. New observations revise or qualify existing notes instead of appending near-duplicates. Concurrent threads submit attributable updates through a controlled write path.

## Revisions, checkpoints, and correction

- Writes include the expected base revision per record, not a global store revision. Concurrent conflicts are surfaced or reconciled with evidence; no last-writer-wins overwrite of another thread's learning.
- Changes append revisions with author/time/reason. Checkpoints capture consistent revision sets atomically.
- Restoring a checkpoint creates a new current state and preserves intervening revision history.
- Restore affects the selected configuration/soul/knowledge state only. It never rewinds conversations, reopens completed work, replays messages/actions, or restores stale runtime routing/session IDs. Validate restored model/project/home references before applying configuration.
- Forgetting suppresses the selected record, excludes its known source IDs, and cascades through provenance to derived memories, summaries, dream outputs and stored continuation packages. Tombstones are monotonic operational exclusions outside checkpoint restore. Do not retain sensitive forgotten text in them. This blocks known-source/derived re-ingestion; it cannot guarantee recognition of the same fact appearing independently in a different source. Do not claim semantic erasure. Suppress known material from new retrieval/briefings; a live provider context may still contain it until a verified clear/re-brief or session replacement.
- Historical deletion/purge is deferred in v1 and distinct from ordinary forgetting. Revisions, old conversation history and previous exports can retain content. Surface this limitation and pending live-session refresh; do not claim complete erasure or silently rewrite history.

Acceptance includes concurrent edits, checkpoint consistency, restore with completed tasks still completed, known forgotten sources and their derivatives staying excluded, and export completeness. Test that an old restored checkpoint cannot bypass a newer tombstone, that stale maintenance results cannot resurrect excluded records, and that limitations for independent sources/live context are visible.

## Retrieval and optional BB memory

Supply only stable soul/configuration guidance and CLI/skill instructions at provider session construction; respect the SDK output bound. Pull volatile memory indexes, active commitments, current contract and recent-state records through `bb bot brief` and relevant CLI reads during ordinary turns. They are not guaranteed-fresh injected instructions. Search deeper records only when relevant, with bounded results and source links. Long history remains retrievable; do not inject full transcripts at every turn or handoff.

Bot memory works without BB memory. When BB memory is available, use its public global/project indexes and retrieval in place. Do not copy everything into each bot or depend on undocumented storage. Sharing a bot fact to global/project memory is an explicit operation permitted by user instruction or established policy. V1 stores no persistent cross-store references or mirrored shared facts: use BB memory tools conditionally in place so current revision/deletion semantics remain owned there. Avoid automatic two-way synchronization; missing shared memory does not break the bot.

## Summaries and dreaming

Memory is maintained during ordinary work; end-of-session summaries are not the only place obligations survive. In-turn capture of decisions, commitments, recent state and processed source boundaries lands with the memory write path (BOTS-10), before continuity. It uses the already authorized agent turn and is distinct from later maintenance that starts another turn. Idle-time summarization and dreaming are separate passes:

1. **Incremental summary:** after substantive activity settles, capture decisions, completed work, open commitments/questions, and evidence references since the last processed boundary.
2. **Dreaming/consolidation:** after a longer quiet period and enough new material, review bounded recent summaries plus relevant memories; merge duplicates, identify recurring lessons, flag contradictions/staleness, and make useful connections.
3. **Next task:** retrieve the resulting relevant memories and active obligations rather than replaying all prior activity.

Dreaming is memory maintenance, not autonomous execution of suggested tasks. Follow-up ideas remain proposals, not authorized commitments. Derived claims retain original evidence and uncertainty; repeated summaries of one observation do not count as independent support. A dream cannot silently revise SOUL.md or promote private observations to shared memory.

Prefer a short-lived maintenance context separate from the active chat, if the public runtime supports it. Prefer a durable scheduled eligibility check through the public scheduling API over idle-triggered sends, subject to BOTS-3 verification. Each model-backed pass is a billable agent run; expose maintenance enablement and bounded cost/frequency policy before enabling it. It must not consume the main conversation's remaining context merely to consolidate memory. Persist processed source boundaries and run outcomes, exclude maintenance output from recursive triggers, bound tokens/time/frequency/concurrency, and yield to user work. Re-check source revisions and forgetting state before committing results. A crash/retry must not create duplicate revisions or skip uncommitted input. Maintenance output is not a second source for evidence counts. Forgetting exclusions must also filter saved transition/briefing packages, not just memory search.

**Lifecycle gate:** idle events do not establish permission to start a run. Disabled background maintenance and user-stopped work prohibit automatic model-backed maintenance. Apply the stop/activation rules in spec.md and continuity.md; ordinary explicit worker reports are a separate communication path. The first implementation task must establish how stop intent, scheduling, cancellation and provider execution are represented. If public support is insufficient, keep automatic dreaming disabled and expose an explicit consolidation action with a documented limitation; do not emulate a completion hook by sending a new turn on every idle event.

Release evidence must show bounded retrieval, revision conflicts, correct forgetting, isolated bots, restart-safe progress, no self-trigger loop, user-work priority, and no automatic maintenance activation after disable/stop. Automatic dreaming remains capability-gated, while in-turn capture/checkpoint reliability is foundational.

## Initial CLI implementation boundary

The offline BOTS-10 slice reuses revisioned documents for knowledge, state, decision and summary records. Per-record compare-and-swap, retained creation hashes, current parent revisions and known-source admission checks run in the same SQLite write transaction. Two operational tables retain original-source provenance and monotonic exclusions; an index supports source lookup. Captures atomically advance a per-kind source cursor with their record, and exact replay returns the current cursor rather than restoring an older one. These cursors and exclusions are operational state, not selected checkpoint content.

Search is bounded literal topic/text retrieval with small excerpts, truthful cursors and separate kinds. Briefs retrieve at most three knowledge excerpts and one state/decision/summary excerpt each. The source window and fact/inference attribution are supplied by the active agent; this is not an automatic transcript scanner or model-backed summary service. Source IDs are retained across corrections, and derived records inherit known original sources. Capture boundaries are mandatory provenance, stored as source windows alongside canonical native message origins; suppression checks window overlap and whole-stream origins without banning later disjoint capture. Forgetting suppresses those sources and derived records even when an older document revision is selected later. Live context/history/purge/independent-restatement limits above remain explicit. Future checkpoint/export/continuation writers must retain exclusions and use this admission/filter path; those integrations remain separately gated, and no automatic maintenance is enabled here.
