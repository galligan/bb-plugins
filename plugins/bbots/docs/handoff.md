# bb Bots Builder handoff

**Current direction:** implementation is released. Matt corrected the approach: handle what is possible inside the plugin and do not ask maintainers to change BB as a prerequisite. BOTS-3 is a feature-specific evidence/support matrix; BOTS-18 is deferred/non-blocking. Proceed through BOTS-4 → minimal storage → identity/home/main → models/SOUL → minimal create/open UI. Independent Tasks and other UI work do not wait for upstream agreement or a release containing the prototype.

## Ownership and environment

- Builder `thr_898bvuxcfi`, parent `thr_cc23h4keqr`, Codex gpt-6.1-sol/high.
- Environment `env_i9zexe2j36`; existing exploration worktree preserved at `/Users/mg/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_cc23h4keqr-1/bb-plugins`.
- Implementation branch `feat/bbots/revisioned-storage`; original exploration and documentation branches retained. Never clean/reset this worktree.
- Dedicated tracker **BOTS**, stable ID `01M73NSQMGEYPWZ30WSR2CEYBP`; never BBP. Matt's “Ok go” and subsequent correction authorize routine implementation/review/merge without another go.

## First code slice

BOTS-4 provides a headless independently buildable `bb-plugin-bbots` package, display Bots, ID bbots. `bb bot status` / `--json` and validated `status` RPC show the development boundary. Use explicit `bb plugin run bbots status` if the command alias collides. BB >=0.49.0, runtime SDK >=0.6.132, exact build SDK 0.6.132. No public bot creation or UI is claimed yet. The next storage slice initializes SQLite, with profile plus unbound main identity created atomically, expected-base writes and exclusive initial thread binding; it makes no SDK thread calls. No event handlers, schedules, agents, automatic maintenance, retry or continuity are registered. Automatic paths are visibly disabled.

BOTS-4 merged in [PR #112](https://github.com/galligan/bb-plugins/pull/112) after fresh Devin No Issues, green CI, ready and exact-head merge checks. BOTS-5 now adds real SQLite profile/document revisions and stable logical mappings. Next is BOTS-6 home/main creation, then BOTS-7 session-bound soul/model guidance. Keep ownership authoritative before first provider construction; metadata is only a checked mirror. Add UI in BOTS-17 after these real capabilities, without replacing the sidebar.

## Controls and support

Native per-thread Stop plus the future persistent per-bot maintenance toggle are the controls; no bot-wide pause and no universal veto over other plugins. Bots must not restart canceled assignments from idle/reload/maintenance. Explicit reports can wake idle recipients as new communications. Keep unsafe automation disabled and show a supported explicit recovery path when available. Preserve the continuity goal for main/workers through durable capture/checkpoints and verified pickup; do not promise behavior the public platform cannot deliver. See [support boundary](support-boundary.md) and [matrix](continuity-matrix.md).

## Preserved investigation

Core checkout `/Users/mg/.worktrees/gh/get-bb/bb/fix-bbots-native-context-admission`, branch `fix/bbots/native-context-admission`, head `56024d263e795e762937c6dc8971923bcb9a3898`, base `9816b9420d76b47c3cbff99fcc620c38527f0388`. [Fork draft #3](https://github.com/galligan/bb/pull/3) and evidence stay intact. No further upstream pings, closing/deleting issues/PRs, fork merge/deployment, internal imports, production replacement or sibling edits are authorized by this correction. Proposed SDK 0.6.139 is not a plugin dependency or verified release.

Evidence PRs #82/#93/#95/#98/#101 are merged. Source-runtime proof and failed setup attempts are retained under builder thread storage `bots-capabilities/`, attached to BOTS-3/BOTS-18. Summary `29-continuity-acceptance-summary.json` records real Stop/restart/override, clear/cancel, explicit report after Stop, native CLI/UI Compact, synthetic Auto Compact callbacks with real SDK attribution, and measured context 38,706→35,044. Six distinct requests, five starts, one missing-rollout rejection; bounded waits, all runtimes stopped. These source-prototype observations do not upgrade installed-runtime guarantees. Earlier readiness claims were corrected in [follow-up](capability-followup.md). Native board navigation and single-host unmanaged home retention are observed; downstream product tests still belong to their implementation tasks.

## Delivery

Follow root Bun 1.3.14 / Node 24 verification and draft → fresh Devin → scoped fixes/review → green CI → ready → exact-head requirements → normal merge. No package publication or production installation. Keep Tasks/spec current as real capability decisions land; no standalone evidence-only PRs to imply implementation progress.
