# Implementation plan

**Released:** Matt explicitly said “Ok go.” to bb Bots Builder on 2026-11-10 after its read-only briefing. Start with BOTS-3; [capability evidence](capabilities.md) records the verified paths and unresolved gates before scaffolding. The earlier briefing hold was respected.

## Board and ownership

BB Tasks project **Bots** (`BOTS`, ID `01M73NSQMGEYPWZ30WSR2CEYBP`), parent **BOTS-1**. The repository retains its BBP board link; this dedicated tracker is selected explicitly. Task descriptions contain intent, dependencies, acceptance and constraints. Installed CLI has no dependency-edge mutation; the following DAG is mirrored in task descriptions instead of pretending native blocking edges exist.

| Task    | Work                                                                | Depends on                                |
| ------- | ------------------------------------------------------------------- | ----------------------------------------- |
| BOTS-2  | Review and finalize the Bots specification                          | —                                         |
| BOTS-3  | Verify public SDK capabilities and establish support gates          | —                                         |
| BOTS-4  | Scaffold the independent bbots package                              | BOTS-3                                    |
| BOTS-5  | Implement minimal revisioned bot storage                            | BOTS-4                                    |
| BOTS-6  | Create bot identity, persistent home and main conversation          | BOTS-3, BOTS-5                            |
| BOTS-7  | Add models, SOUL.md and initial operating skills                    | BOTS-5, BOTS-6                            |
| BOTS-8  | Implement owned working threads, contracts and native bot messaging | BOTS-6, BOTS-7                            |
| BOTS-9  | Integrate bot task boards and tasks.md fallback                     | BOTS-3, BOTS-6, BOTS-7                    |
| BOTS-10 | Implement memory and in-turn state capture                          | BOTS-5, BOTS-7, BOTS-9                    |
| BOTS-11 | Implement the verified continuity preference ladder                 | BOTS-3, BOTS-8, BOTS-9, BOTS-10, BOTS-16  |
| BOTS-12 | Implement bounded provider fallback with visible recovery           | BOTS-7, BOTS-11                           |
| BOTS-13 | Add idle summaries and evidence-based dreaming                      | BOTS-3, BOTS-10                           |
| BOTS-14 | Build remaining Bots management and thread surfaces                 | BOTS-8, BOTS-9, BOTS-10, BOTS-11, BOTS-17 |
| BOTS-15 | Validate end-to-end continuity and complete reviewed PR delivery    | BOTS-12, BOTS-13, BOTS-14, BOTS-16        |
| BOTS-16 | Implement checkpoints, restore and portable export                  | BOTS-5, BOTS-10                           |
| BOTS-17 | Add the minimal Bots create/open surface                            | BOTS-6, BOTS-7                            |

## Sequence and scope

BOTS-2 completes planning/review and the held handoff. BOTS-3 answers in-thread versus successor first. The walking skeleton is BOTS-4 → BOTS-5 minimal storage → BOTS-6 Bob/home/main → BOTS-7 models/soul/configure/skill skeleton → BOTS-17 minimal create/open UI. Full checkpoints/export move to BOTS-16 after memory; full UI remains BOTS-14. Workers (BOTS-8) and Tasks (BOTS-9) extend the earlier operating skill independently. BOTS-10 implements in-turn state capture before BOTS-11 consumes it. BOTS-11 depends on BOTS-16 for durable checkpoint semantics. BOTS-13 owns only separately gated idle maintenance and does not block foundational summary capture.

No milestone silently drops seamless continuity from the product. A provider/API gap is a documented release gate for that path. Automatic dreaming is explicitly conditional on safe lifecycle support; manual consolidation can demonstrate the logic while that gap remains open. Fallback combinations are only enabled when verified.

## Definition of ready to build

- Review the specification against the complete design conversation, including final scope corrections.
- Resolve material planning findings and record remaining capability questions as explicit gates.
- Every task has a check that proves the intended behavior and a clear predecessor order.
- Builder is briefed on this worktree, current diff, tracker, model, no-start rule and reviewer dispositions.
- Matt explicitly releases the builder; review approval alone is not authorization.

## Definition of done

Implement → verify → adjust in small scoped steps. Follow root Bun pin and repository commands; before pushing run format:check, lint, check, test and build. Root checks exclude Linear, which is not touched here. Use targeted behavioral tests for storage conflicts, transitions, stop/failure boundaries and task-source authority, plus live host inspection for UI behavior. Do not claim live integration from source inspection alone. Keep the PR draft until CI passes; address review findings before ready status.

Document capability matrix, supported-provider scope, retained history/forget semantics, manual task-source transitions, bot-home lifetime and recovery steps. Preserve history and user artifacts. Release evidence must cover all acceptance scenarios in spec.md, memory.md and continuity.md, with explicit unsupported paths rather than silent promises.

## Test boundaries

Use public SDK fakes/harnesses for transition, failure, race and stale-measurement tests; do not manufacture expensive provider exhaustion for fault injection. Live smoke runs only after Matt releases implementation, on dedicated test bots/environments, at most two supported providers and three short agent turns per scenario. BOTS-3 establishes actual per-run limits and available isolated host location; if limits cannot be enforced, narrow to a manually bounded smoke. No tests may compact, clear or hand off Matt's production conversations. Record tested providers, cost/limits and remaining gaps. Do not disable user plugins to make coexistence pass.

## PR review and merge workflow

Matt authorized the same workflow as the Radio thread for Bots PRs once implementation starts: open scoped draft PRs, watch for Devin reviews, fix actionable findings, reply to and resolve addressed review threads, and wait for review on the updated diff when needed. Keep drafts until CI is green and review findings are resolved or explicitly settled. Then mark ready, verify all required checks and merge requirements on the current head, merge, and continue with the next scoped PR. No separate per-PR merge confirmation is needed within this authorized scope. Do not bypass branch protections, dismiss unresolved findings, or treat a missing/pending Devin review as approval. Address other reviewer findings under the repository's normal rules too.

Matt has released implementation. Do not publish a package or expand scope as part of merging unless separately authorized.
