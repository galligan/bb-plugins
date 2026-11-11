# bb Bots Builder handoff

**Current direction:** implementation is released. Matt corrected the approach: handle what is possible inside the plugin and do not ask maintainers to change BB as a prerequisite. BOTS-3 is a feature-specific evidence/support matrix; BOTS-18 is deferred/non-blocking. Proceed through BOTS-4 → minimal storage → identity/home/main → models/SOUL → minimal create/open UI. Independent Tasks and other UI work do not wait for upstream agreement or a release containing the prototype.

## Ownership and environment

- Builder `thr_898bvuxcfi`, parent `thr_cc23h4keqr`, Codex gpt-6.1-sol/high.
- Environment `env_i9zexe2j36`; existing exploration worktree preserved at `/Users/mg/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_cc23h4keqr-1/bb-plugins`.
- Implementation branches `feat/bbots/main-home` (BOTS-6 merged) and `feat/bbots/soul-models` (BOTS-7); original exploration and documentation branches retained. Never clean/reset this worktree.
- Dedicated tracker **BOTS**, stable ID `01M73NSQMGEYPWZ30WSR2CEYBP`; never BBP. Matt's “Ok go” and subsequent correction authorize routine implementation/review/merge without another go.

## Delivered and current slices

BOTS-4 merged in [PR #112](https://github.com/galligan/bb-plugins/pull/112), and BOTS-5 in [PR #113](https://github.com/galligan/bb-plugins/pull/113), after fresh Devin No Issues, green CI and exact-head merge checks. They establish public status and revisioned SQLite storage.

BOTS-6 adds CLI/RPC home/main creation with persisted intent, pre-construction ownership admission, safe partial recovery, project responsibility scope and native initial title/pin. A minimal revisioned starter SOUL/configure binding is pulled forward to cover the first session; BOTS-7 retains editing/model controls, applied-revision presentation and fuller skills. Resume never resends the setup prompt or repins an existing main. Uncertain pre-admission outcomes remain visible and are not blindly retried. No home is deleted by lifecycle handlers.

The actual server and host entries pass offline public SDK harness tests. Shared Dev acceptance must be scheduled separately with `thr_my8t4atsyy`; no install/reload/settings change is allowed outside that slot. BOTS-7 and BOTS-17 can be prepared independently while a live slot is queued; no new release from Matt is needed between routine milestones. Preserve native controls and use additive UI only.

BOTS-6 merged in [PR140](https://github.com/galligan/bb-plugins/pull/140) as `348d585` after fresh exact-head Devin, CI and bounded shared Dev acceptance on `77ebaf0`. Exactly one short no-tools setup turn, rename/unpin/reload/archive/home retention passed; fixture `thr_geqas74r5f` is stopped/archived, bbots disabled, queue/children empty and home/history preserved. Dev reported BB0.49.0/runtime SDK0.6.140; keep that separate from stable bundled0.6.132. BOTS-7 supplies revision-checked SOUL/default editing and bounded brief, with applied revision explicitly unknown because configuration resolution has no session receipt. Automatic refresh/fallback stays disabled. BOTS-17 owns minimal UI/native pickers; harness owner cleared package-local frontend/test dependencies and additive generated lock entries, with no root manifest/scripts/SDK pin changes.

BOTS-7 merged in [PR143](https://github.com/galligan/bb-plugins/pull/143) as `9d0ce66`, after exact `e6e08e9` fresh Devin/CI and all six gates on Bun1.4.4/TypeScript7.0.2. Supply records reference stable logical conversations, preserving predecessor history without constraining future physical cutovers or certifying a successor. BOTS-17 branch `feat/bbots/create-open` adds the panel, header, native pickers and request-key recovery. Its coordinated manifest/lock additions follow reviewed `e7223af` and preflight baseline `d87a579`; lock changes add only bbots workspace dependency entries, and frozen install is unchanged. SDK0.6.138 is now stale against published0.6.140: preflight exit2 is report-and-continue. Coordinator ordered the BOTS-17 PR first, then harness owner owns the SDK bump; never regenerate concurrently or bump it in this slice. Final visual candidate must incorporate that reviewed baseline deliberately. Shared Dev remains mutation-held until another explicit slot release.

## Controls and support

Native per-thread Stop plus the future persistent per-bot maintenance toggle are the controls; no bot-wide pause and no universal veto over other plugins. Bots must not restart canceled assignments from idle/reload/maintenance. Explicit reports can wake idle recipients as new communications. Keep unsafe automation disabled and show a supported explicit recovery path when available. Preserve the continuity goal for main/workers through durable capture/checkpoints and verified pickup; do not promise behavior the public platform cannot deliver. See [support boundary](support-boundary.md) and [matrix](continuity-matrix.md).

## Preserved investigation

Core checkout `/Users/mg/.worktrees/gh/get-bb/bb/fix-bbots-native-context-admission`, branch `fix/bbots/native-context-admission`, head `56024d263e795e762937c6dc8971923bcb9a3898`, base `9816b9420d76b47c3cbff99fcc620c38527f0388`. [Fork draft #3](https://github.com/galligan/bb/pull/3) and evidence stay intact. No further upstream pings, closing/deleting issues/PRs, fork merge/deployment, internal imports, production replacement or sibling edits are authorized by this correction. Proposed SDK 0.6.139 is not a plugin dependency or verified release.

Evidence PRs #82/#93/#95/#98/#101 are merged. Source-runtime proof and failed setup attempts are retained under builder thread storage `bots-capabilities/`, attached to BOTS-3/BOTS-18. Summary `29-continuity-acceptance-summary.json` records real Stop/restart/override, clear/cancel, explicit report after Stop, native CLI/UI Compact, synthetic Auto Compact callbacks with real SDK attribution, and measured context 38,706→35,044. Six distinct requests, five starts, one missing-rollout rejection; bounded waits, all runtimes stopped. These source-prototype observations do not upgrade installed-runtime guarantees. Earlier readiness claims were corrected in [follow-up](capability-followup.md). Native board navigation and single-host unmanaged home retention are observed; downstream product tests still belong to their implementation tasks.

## Delivery

Follow the current root toolchain / Node 24 verification and draft → fresh Devin → scoped fixes/review → green CI → ready → exact-head requirements → normal merge. No package publication or production installation. Keep Tasks/spec current as real capability decisions land; no standalone evidence-only PRs to imply implementation progress.

## Resumed integration

Sole writer in the same environment/worktree. Owned branch safely fast-forwarded from `a18602f` through `0c962d6` to `c55e163e3d75effcffdc2e4c3368286a54d58509`, without reset/rewrite. Actual root preflight passes on that repaired baseline: stable BB 0.49.0, bundled SDK 0.6.132, repo pin 0.6.138. The earlier ignored-Linear discovery failure and tracked-manifest diagnostic are retained separately in builder artifacts. Harness owner owns shared scripts/dependency/lock changes; none are made by this slice. All shared Dev mutations must be scheduled by `thr_my8t4atsyy`; preserve theme and unrelated conversations.
