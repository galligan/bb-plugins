# Native continuity admission gate

Status: Matt explicitly authorized a separately scoped BB core/SDK investigation and minimal fix on 2026-11-10 in `thr_898bvuxcfi`. BOTS-18 owns that work, which unblocks BOTS-3. This does not authorize sibling-plugin or Radio changes or production installation of an unreleased BB build.

## Problem

Bots must preserve native Stop intent and coexist with installed plugins that compact sessions. BB 0.49.0 / public SDK 0.6.132 exposes both a message dispatch hook and `threads.compact`, but the isolated probe observed the latter return success without reaching the hook's record-and-reject branch. Ordinary first-message dispatch was held by the same plugin hook before construction. Source attribution on the earlier native compact request also lacked `originPluginId` and identified the initiator as `user` despite a plugin SDK caller.

The installed Auto Compact source at commit `f580248bb0ea038187d0f542db9d0a4ab66d9c22` listens to `thread.idle` and `thread.failed`, then calls `threads.compact` after a usage threshold and cooldown. It does not inspect `system/thread/interrupted` for `manual-stop`. Bots cannot infer consent from that idle/failed state or assume its dispatch guard can prevent that call. No production stopped/high-context conversation was used to trigger this combination; the admission gap is directly observed, and the post-Stop combination is a source-based risk requiring a dedicated regression.

## Reproduction

Use a fresh isolated BB instance and a small public-API probe plugin. Keep a SQLite counter/log for hook invocation so ephemeral console logging is not the only observation.

1. Register `message.dispatch` to hold the probe's new thread until its SQLite ownership row exists. Spawn a single no-tools marker prompt; observe pending state, a queued message and zero `agents.configure` invocations. Record ownership, recheck, and finish that one short turn.
2. While the runtime is idle and loaded, enable an observation flag. When that flag is set, the hook records its entire dispatch context and returns `reject` before any origin/ownership filter.
3. Explicitly call `bb.sdk.threads.compact({ threadId })` against that probe thread. Keep the observation flag enabled beyond acceptance until the new turn completes or a bounded wait expires. Record the return value, new event boundary and hook observation rows. Stop the dedicated runtime promptly; never use a production conversation.
4. In the sustained check, compact returned `{ ok: true }`. The flag stayed enabled from sequence 104 through the new completed turn at sequence 113, and the hook recorded zero dispatches. Earlier compaction produced a completed native `contextCompaction` item. There was no rejection from the observation hook. An earlier immediate-counter check alone would have been inconclusive. A negative control then armed the same guard and called ordinary `threads.send`: the request received HTTP 409, logged its attributed dispatch and started no turn.

Probe source and result: `/Users/mg/.bb/thread-storage/thr_898bvuxcfi/bots-capabilities/probe/server.ts`, `10-sustained-compact-observation.json`, and `13-send-negative-control.json`. The probe has no automatic trigger. Its failed exploratory calls and manually bounded limits are disclosed in [capabilities](capabilities.md).

## Authorized core prototype

BOTS-18 produced a separately scoped [core prototype at f77480ca4](https://github.com/galligan/bb/commit/f77480ca428c466edd6e6c498617555d99125ac7), based on current main `9816b9420d76b47c3cbff99fcc620c38527f0388` (public SDK 0.6.138). It routes native Compact through ordinary dispatch admission, preserves bound-plugin caller provenance through waiting and drain, and refuses revoked caller credentials rather than treating them as ordinary API calls. Compact-before-send retains its intent in the existing durable queue; the compaction request and follow-up transition commit together. Losing a queue claim prevents compaction. There is no new hook, scheduler, SQL migration or daemon wire field.

Verification passed: 56 focused server tests, 62 DB queue/wait tests, five domain lifecycle tests, ten CLI/guide tests, affected server/DB/domain/SDK typechecks and type-aware lint, formatting, and server/daemon builds. Red regressions reproduced the native admission bypass, compact-before-send starting work before rejection, stale claim dispatch, and revoked caller identity downgrade before their respective fixes.

The initial source-runtime smoke proved server rejection and attribution, but its readiness check did not establish daemon startup: the source daemon had exited because its built CLI runtime was missing. That claim is corrected in [the readiness follow-up](capability-followup.md#runtime-readiness-correction). After building the CLI and requiring both processes alive, a connected host and registered Codex provider, the source-runtime check passed again. Bound-plugin Compact, the native endpoint and compact-before-send reached HTTP 409 rejection; the bound plugin retained its real `originPluginId`, and an invalid caller credential received 403. Sequence 131 stayed unchanged and no provider request was added across any copied thread. Both processes were stopped. Corrected evidence: `18-source-runtime-verified.json` and `source-runtime-verified.py`. Earlier setup/evidence files are retained and explicitly superseded.

This is a tested prototype, not a shipped public contract. [Maintainer alignment is requested on the related issue](https://github.com/get-bb/bb/issues/6134#issuecomment-6781783821) before an upstream feature PR, as BB's CONTRIBUTING.md requires. The broader issue requests mandatory runtime authorization and provider receipts; this prototype does not close it. Existing initiator classification and the explicit Send now policy override remain. The additive public queue payload kind `compact-first` needs compatibility review. The current core draft is [fork PR #3](https://github.com/galligan/bb/pull/3), head `56024d263` (minimum-version/rollback documentation after the unchanged runtime logic at `05f2aa9b9`), with proposed SDK 0.6.139; its local release/version checks and app consumer typecheck pass. This is a review artifact against the pinned upstream base, not an upstream feature submission or a released version floor. Patched-provider completion, UI interactions, full Stop/override/restart coexistence and measured context reduction remain unverified. BOTS-18 and BOTS-3 remain incomplete; BOTS-4 remains unstarted.

## Queue and Stop follow-up

The [follow-up prototype at ceb5bca71](https://github.com/galligan/bb/commit/ceb5bca715285dc7b77237ff3575e56b1a42d6c6) adds five real-SQLite queue-contract tests. Cancellation, edits, grouped compaction and unrelated-thread admission pass. A native manual Stop arriving during admission reproduced one compaction submission when the request had previously waited on a plugin. Automatic compact-first drain now honors the existing manual-stop pause for that row. Explicit Send now remains the native override; a second regression fixes the false HTTP 409 that was returned after that override had already started compaction. The internal result distinguishes accepted compaction from a blocked core wait while retaining the public queued-follow-up response.

All 61 focused server tests pass, along with affected server/public-SDK typechecks, type-aware lint, formatting and builds. The [upstream follow-up](https://github.com/get-bb/bb/issues/6134#issuecomment-6782222327) records this evidence. These are server tests with real SQLite and a fake host boundary, not a full live Stop/provider coexistence claim. See [capability follow-up](capability-followup.md) for the independently verified native Tasks route and home archive/restart behavior. Maintainer agreement and the broader support gate remain open.

## Minimum upstream acceptance

Use the [continuity acceptance matrix](continuity-matrix.md) to distinguish source-runtime passes, fake-host server tests and remaining live gates. Its bounded compatibility check establishes that the pinned baseline mapper throws for a retained `compact-first` row and its public payload schema rejects the new kind. Matt chose [explicit minimum versions and snapshot-based rollback](support-boundary.md) instead of full backward/downgrade compatibility. Existing manifest engine gates enforce plugin admission; older core readers are protected only by keeping post-upgrade data on the supported runtime. Numeric released floors and upstream contract agreement remain pending. No SQL migration does not imply old-reader compatibility.

First establish whether native compaction intentionally has a different admission surface. If a supported existing surface can authorize and cancel it while preserving genuine human dispatch, document that surface and reproduce it before proposing new APIs.

If no such surface exists, a separately authorized BB SDK change should ensure model-backed native context operations have admission semantics that preserve:

- Causal initiator and caller attribution, distinguishing a person requesting compact from a plugin requesting it.
- A supported guard/consent point for those operations, including operations triggered by another plugin after Stop; it must not be inferred from a successful idle transition.
- Correct behavior for canceled or held queued work, no resumed stopped assignment, and no accidental bypass through Send now, retry, clear/re-brief or reload.
- Completion evidence separate from acceptance, plus fresh context measurement or an explicit unavailable result.

The smallest implementation may be an existing dispatch route rather than a new hook. Do not add a general broker or a second queue. Test the native Compact UI/CLI and `compactFirst` alongside the plugin call; a guard that works only for one caller is insufficient. Cover reload/disposal and scope only bot-owned conversations so unrelated conversations retain native behavior.

Until resolved, keep the affected automatic support path gated. Do not disable or rewrite Matt's installed Auto Compact plugin, claim that a dispatch hook covers all context operations, or silently replace automatic continuity with an operating-skill promise.
