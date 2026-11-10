# Native continuity admission gate

Status: proposed upstream contract investigation for BOTS-3; no BB core or sibling-plugin change is authorized by this document.

## Problem

Bots must preserve native Stop intent and coexist with installed plugins that compact sessions. BB 0.49.0 / public SDK 0.6.132 exposes both a message dispatch hook and `threads.compact`, but the isolated probe observed the latter return success without reaching the hook's record-and-reject branch. Ordinary first-message dispatch was held by the same plugin hook before construction. Source attribution on the earlier native compact request also lacked `originPluginId` and identified the initiator as `user` despite a plugin SDK caller.

The installed Auto Compact source at commit `f580248bb0ea038187d0f542db9d0a4ab66d9c22` listens to `thread.idle` and `thread.failed`, then calls `threads.compact` after a usage threshold and cooldown. It does not inspect `system/thread/interrupted` for `manual-stop`. Bots cannot infer consent from that idle/failed state or assume its dispatch guard can prevent that call. No production stopped/high-context conversation was used to trigger this combination; the admission gap is directly observed, and the post-Stop combination is a source-based risk requiring a dedicated regression.

## Reproduction

Use a fresh isolated BB instance and a small public-API probe plugin. Keep a SQLite counter/log for hook invocation so ephemeral console logging is not the only observation.

1. Register `message.dispatch` to hold the probe's new thread until its SQLite ownership row exists. Spawn a single no-tools marker prompt; observe pending state, a queued message and zero `agents.configure` invocations. Record ownership, recheck, and finish that one short turn.
2. While the runtime is idle and loaded, enable an observation flag. When that flag is set, the hook records its entire dispatch context and returns `reject` before any origin/ownership filter.
3. Explicitly call `bb.sdk.threads.compact({ threadId })` against that probe thread. Keep the observation flag enabled beyond acceptance until the new turn completes or a bounded wait expires. Record the return value, new event boundary and hook observation rows. Stop the dedicated runtime promptly; never use a production conversation.
4. In the sustained check, compact returned `{ ok: true }`. The flag stayed enabled from sequence 104 through the new completed turn at sequence 113, and the hook recorded zero dispatches. Earlier compaction produced a completed native `contextCompaction` item. There was no rejection from the observation hook. An earlier immediate-counter check alone would have been inconclusive. A negative control then armed the same guard and called ordinary `threads.send`: the request received HTTP 409, logged its attributed dispatch and started no turn.

Probe source and result: `/Users/mg/.bb/thread-storage/thr_898bvuxcfi/bots-capabilities/probe/server.ts` , `10-sustained-compact-observation.json`, and `13-send-negative-control.json`. The probe has no automatic trigger. Its failed exploratory calls and manually bounded limits are disclosed in [capabilities](capabilities.md).

## Minimum upstream acceptance

First establish whether native compaction intentionally has a different admission surface. If a supported existing surface can authorize and cancel it while preserving genuine human dispatch, document that surface and reproduce it before proposing new APIs.

If no such surface exists, a separately authorized BB SDK change should ensure model-backed native context operations have admission semantics that preserve:

- Causal initiator and caller attribution, distinguishing a person requesting compact from a plugin requesting it.
- A supported guard/consent point for those operations, including operations triggered by another plugin after Stop; it must not be inferred from a successful idle transition.
- Correct behavior for canceled or held queued work, no resumed stopped assignment, and no accidental bypass through Send now, retry, clear/re-brief or reload.
- Completion evidence separate from acceptance, plus fresh context measurement or an explicit unavailable result.

The smallest implementation may be an existing dispatch route rather than a new hook. Do not add a general broker or a second queue. Test the native Compact UI/CLI and `compactFirst` alongside the plugin call; a guard that works only for one caller is insufficient. Cover reload/disposal and scope only bot-owned conversations so unrelated conversations retain native behavior.

Until resolved, keep the affected automatic support path gated. Do not disable or rewrite Matt's installed Auto Compact plugin, claim that a dispatch hook covers all context operations, or silently replace automatic continuity with an operating-skill promise.
