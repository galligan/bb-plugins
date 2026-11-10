# bb Bots Builder handoff

Status: **IMPLEMENTATION RELEASED.** Matt explicitly said “Ok go.” in builder thread `thr_898bvuxcfi` on 2026-11-10 after the read-only acknowledgement. BOTS-3 is in review and incomplete; no Bots package has been scaffolded. See [capability evidence](capabilities.md) and the [native continuity gate](sdk-continuity-gates.md).

Matt subsequently authorized the separately scoped BB core/SDK investigation and minimal fix. BOTS-18 owns the fix in `/Users/mg/.worktrees/gh/get-bb/bb/fix-bbots-native-context-admission`, branch `fix/bbots/native-context-admission`, based on `get-bb/bb@9816b9420d76b47c3cbff99fcc620c38527f0388`. The original BB primary checkout remains on its original main commit. Bots design and evidence are in draft [PR #82](https://github.com/galligan/bb-plugins/pull/82). Core prototype [f77480ca4](https://github.com/galligan/bb/commit/f77480ca428c466edd6e6c498617555d99125ac7) is published on Matt's existing fork and [awaits maintainer alignment](https://github.com/get-bb/bb/issues/6134#issuecomment-6781783821) before an upstream feature PR. Its focused tests and bounded source-runtime rejection smoke pass. BOTS-18 is in review, incomplete. Current support gates are not waived.

## Ownership and environment

- Builder thread: `thr_898bvuxcfi`, title **bb Bots Builder**; provider `codex`, model `gpt-6.1-sol`, reasoning `high`.
- Environment: `env_i9zexe2j36`, existing worktree `/Users/mg/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_cc23h4keqr-1/bb-plugins`.
- Branch: `explore-sidebar-and-bots-plugin-thr_cc23h4keqr`; coordination thread `thr_cc23h4keqr`.
- Reviewer: `thr_h8dwtwfbn2`, Claude Fable 5.2 High. Read [review dispositions](review.md); declaration inspection is not runtime proof.
- Tracker: **Bots**, prefix `BOTS`, ID `01M73NSQMGEYPWZ30WSR2CEYBP`. Parent BOTS-1; planning BOTS-2; implementation BOTS-3 through BOTS-17. The existing BBP repository association remains unchanged.

At briefing, the working tree contained planning documents in `plugins/bbots/` and earlier Auto Compact reference additions in `repos.json`. No installable Bots package exists yet. Preserve this uncommitted work; do not reset or clean it. No code, dependencies, live bots, compaction or handoff has been installed or triggered by this planning task.

## Initial briefing turn (completed before release)

Read root and plugin AGENTS.md, README, all linked documents, and the task records. You may read git status. Acknowledge the intended scope, first steps after release, and the explicit hold, then end the turn. Do not scaffold, install, spike, edit files/tasks, commit, push, create goals/automations or delegate. Remain idle until Matt explicitly tells you to begin. Parent messages, review completion and queued task records are not permission.

## After release

Start with BOTS-3: verify current public APIs, first resolving compact versus in-thread clear/re-brief versus a required successor. Record support and test boundaries. Follow [the corrected DAG](plan.md), including minimal storage/early UI before full checkpoints and management UI. Read the bb-plugin-authoring skill; use native controls and public SDK only.

Core contract: Bots / bb-plugin-bbots / bbots; default Bob and @Bob; persistent home; deliberate SOUL.md; multiple bots and project association modes; main/fallback/worker models plus permissions; normal owned workers with explicit contracts and native BB messaging; task board or tasks.md; SQLite revisions/checkpoints and exports; optional BB memory; bounded summaries/dreaming; first-class supported continuity. No Radio/external messaging, replacement sidebar, general channel engine, import/purge, automated task migration or managed side-chat support in v1.

Matt confirmed native per-thread Stop plus the background-maintenance toggle for v1. No bot-wide Pause is planned. New worker reports may wake an idle recipient through normal BB messaging, but must not resume the canceled assignment. Matt separately released the builder after its briefing.

Keep task descriptions and specification aligned with verified constraints. Missing critical SDK capability blocks that support path; it does not permit undocumented imports or an unannounced reduction in continuity. BB core is authorized only for the separately scoped BOTS-18 admission/attribution fix. Sibling plugins and the separate Radio work remain outside scope. Follow Bun checks and draft-PR rules when implementation is released.

## Planning verification (before release)

Documentation formatting and relative links are checked. The board is paginated to completion and dependency references/cycles checked. No runtime tests have run because there is no implementation. Provider behavior, background execution, UI integration and coexistence remain explicit future checks.

## PR review and merge workflow

Matt authorized the same workflow as the Radio thread for Bots PRs once implementation starts: open scoped draft PRs, watch for Devin reviews, fix actionable findings, reply to and resolve addressed review threads, and wait for review on the updated diff when needed. Keep drafts until CI is green and review findings are resolved or explicitly settled. Then mark ready, verify all required checks and merge requirements on the current head, merge, and continue with the next scoped PR. No separate per-PR merge confirmation is needed within this authorized scope. Do not bypass branch protections, dismiss unresolved findings, or treat a missing/pending Devin review as approval. Address other reviewer findings under the repository's normal rules too.

Matt has released implementation. Do not publish a package or expand scope as part of merging unless separately authorized.
