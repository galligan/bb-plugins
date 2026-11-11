# bb Bots Builder handoff

Status: **IMPLEMENTATION RELEASED.** Matt explicitly said “Ok go.” in builder thread `thr_898bvuxcfi` on 2026-11-10 after the read-only acknowledgement. BOTS-3 is in review and incomplete; no Bots package has been scaffolded. See [capability evidence](capabilities.md) and the [native continuity gate](sdk-continuity-gates.md).

Matt subsequently authorized the separately scoped BB core/SDK investigation and minimal fix. BOTS-18 owns the fix in `/Users/mg/.worktrees/gh/get-bb/bb/fix-bbots-native-context-admission`, branch `fix/bbots/native-context-admission`, based on `get-bb/bb@9816b9420d76b47c3cbff99fcc620c38527f0388`. The original BB primary checkout remains on its original main commit. Bots design and initial evidence were merged in [PR #82](https://github.com/galligan/bb-plugins/pull/82). Core prototype [f77480ca4](https://github.com/galligan/bb/commit/f77480ca428c466edd6e6c498617555d99125ac7) is published on Matt's existing fork and [awaits maintainer alignment](https://github.com/get-bb/bb/issues/6134#issuecomment-6781783821) before an upstream feature PR. Its focused tests and bounded source-runtime rejection smoke pass. The [latest prototype ceb5bca71](https://github.com/galligan/bb/commit/ceb5bca715285dc7b77237ff3575e56b1a42d6c6) adds queue/Stop regression coverage, with 61 server tests and affected checks green. The current code is [fork draft PR #3](https://github.com/galligan/bb/pull/3), head `56024d263`, with proposed SDK 0.6.139. This latest commit adds minimum-version/rollback documentation only; runtime evidence remains pinned to `05f2aa9b9`. Existing version/release checks and app typecheck pass locally; 143 compatibility tests and affected SDK checks also pass. Prior-head review was clean; fresh review of the documentation head and remote CI remain separate gates. Remote CI is queued on its configured Blacksmith runner. BOTS-18 remains in review, incomplete. Current support gates are not waived.

## Ownership and environment

- Builder thread: `thr_898bvuxcfi`, title **bb Bots Builder**; provider `codex`, model `gpt-6.1-sol`, reasoning `high`.
- Environment: `env_i9zexe2j36`, existing worktree `/Users/mg/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_cc23h4keqr-1/bb-plugins`.
- Current branch: `docs/bbots/minimum-version-support`, based on merged main `a1e465d`; coordination thread `thr_cc23h4keqr`. The original exploration branch is preserved at `5799fd01f91086f07f164b45963ba1ddd12a2c0d`.
- Reviewer: `thr_h8dwtwfbn2`, Claude Fable 5.2 High. Read [review dispositions](review.md); declaration inspection is not runtime proof.
- Tracker: **Bots**, prefix `BOTS`, ID `01M73NSQMGEYPWZ30WSR2CEYBP`. Parent BOTS-1; planning BOTS-2; implementation BOTS-3 through BOTS-17. The existing BBP repository association remains unchanged.

At briefing, the working tree contained planning documents in `plugins/bbots/` and earlier Auto Compact reference additions in `repos.json`. No installable Bots package exists yet. Those changes were preserved and merged through PR #82; never reset or clean this worktree. No code, dependencies, live bots, compaction or handoff has been installed or triggered by this planning task.

## Initial briefing turn (completed before release)

Read root and plugin AGENTS.md, README, all linked documents, and the task records. You may read git status. Acknowledge the intended scope, first steps after release, and the explicit hold, then end the turn. Do not scaffold, install, spike, edit files/tasks, commit, push, create goals/automations or delegate. Remain idle until Matt explicitly tells you to begin. Parent messages, review completion and queued task records are not permission.

## After release

Start with BOTS-3: verify current public APIs, first resolving compact versus in-thread clear/re-brief versus a required successor. Record support and test boundaries. Follow [the corrected DAG](plan.md), including minimal storage/early UI before full checkpoints and management UI. Read the bb-plugin-authoring skill; use native controls and public SDK only.

Core contract: Bots / bb-plugin-bbots / bbots; default Bob and @Bob; persistent home; deliberate SOUL.md; multiple bots and project association modes; main/fallback/worker models plus permissions; normal owned workers with explicit contracts and native BB messaging; task board or tasks.md; SQLite revisions/checkpoints and exports; optional BB memory; bounded summaries/dreaming; first-class supported continuity. No Radio/external messaging, replacement sidebar, general channel engine, import/purge, automated task migration or managed side-chat support in v1.

Matt confirmed native per-thread Stop plus the background-maintenance toggle for v1. No bot-wide Pause is planned. New worker reports may wake an idle recipient through normal BB messaging, but must not resume the canceled assignment. Matt separately released the builder after its briefing.

Keep task descriptions and specification aligned with verified constraints. Missing critical SDK capability blocks that support path; it does not permit undocumented imports or an unannounced reduction in continuity. BB core is authorized only for the separately scoped BOTS-18 admission/attribution fix. Sibling plugins and the separate Radio work remain outside scope. Follow Bun checks and draft-PR rules when implementation is released.

## Current verification and next work

Matt chose minimum supported BB/runtime and SDK versions in the coordinator, relaxing full backward/downgrade compatibility. The [support boundary](support-boundary.md) selects existing `engines.bb` plus `engines.bbPluginSdk`, separates the build dependency from runtime checks and persisted-data safety, and requires a pre-upgrade snapshot before the changed core first runs. In-place rollback is unsupported; an older core must use the matching pre-upgrade snapshot while post-upgrade data stays preserved separately. This is an operator procedure, not a retrospective old-binary guard or production restore authorization. All 143 existing manifest/install/load/update/SDK compatibility tests pass. SDK 0.6.139 remains unpublished at the dated registry check, so no numeric supported floor is selected. Upstream agreement, CI and live continuity gates remain.

The [continuity acceptance matrix](continuity-matrix.md) makes remaining Stop/override/retry/clear/successor/coexistence gates explicit. A new source-extracted compatibility check establishes that the pinned baseline payload reader throws an internal error for a retained compact-first row, while its public payload schema rejects that kind. The prototype reads it and existing inline/retry controls match. This is not a full downgrade test; Matt has since chosen the minimum-version and pre-upgrade-snapshot boundary above, with old readers outside support. Evidence and reproduction script are attached to BOTS-18. PR #95 has merged; the core draft still has clean current-head Devin review, queued remote CI and no upstream maintainer response at the latest bounded check. No duplicate upstream ping was sent.

Read [capability follow-up](capability-followup.md): native Tasks board navigation and single-host unmanaged home retention through archive/restart are now observed. PRs #82 and #93 merged after fresh Devin review with zero open findings and all current-head checks green. The first source smoke overstated daemon participation; corrected source, home and held-queue restart checks now require both live processes, connected host and registered provider, and all pass with zero added provider requests. Read the explicit correction and superseding evidence in the follow-up. BOTS-3 and BOTS-18 remain incomplete; BOTS-4 is unstarted. Continue independent capability checks while awaiting supported upstream compaction-contract alignment. Matt's authorization persists; another go is not required. No production app replacement, sibling-plugin work or continuity waiver is authorized.

## Planning verification (before release)

Documentation formatting and relative links are checked. The board is paginated to completion and dependency references/cycles checked. No runtime tests have run because there is no implementation. Provider behavior, background execution, UI integration and coexistence remain explicit future checks.

## PR review and merge workflow

Matt authorized the same workflow as the Radio thread for Bots PRs once implementation starts: open scoped draft PRs, watch for Devin reviews, fix actionable findings, reply to and resolve addressed review threads, and wait for review on the updated diff when needed. Keep drafts until CI is green and review findings are resolved or explicitly settled. Then mark ready, verify all required checks and merge requirements on the current head, merge, and continue with the next scoped PR. No separate per-PR merge confirmation is needed within this authorized scope. Do not bypass branch protections, dismiss unresolved findings, or treat a missing/pending Devin review as approval. Address other reviewer findings under the repository's normal rules too.

Matt has released implementation. Do not publish a package or expand scope as part of merging unless separately authorized.
