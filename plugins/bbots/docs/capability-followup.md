# Capability follow-up

Date: 2026-11-10. Tasks BOTS-3 and BOTS-18 remain incomplete. Matt's release and separate core/SDK authorization continue to apply; there is no executable Bots package yet.

## Deferred compaction, queues and Stop

The [core follow-up at ceb5bca71](https://github.com/galligan/bb/commit/ceb5bca715285dc7b77237ff3575e56b1a42d6c6) adds five contract tests using real SQLite and a fake host RPC boundary: cancellation of a held request, editing its follow-up, grouped compaction requested by a later row, native Stop during admission, and a guard limited to one conversation with an unrelated-thread control. Shared compaction fixtures keep the test files focused.

A compact-first request that initially waited on a plugin could start compaction after a manual Stop arrived during admission. Its automatic retry now observes the existing native Stop pause. The test first reproduced one provider submission and now observes zero, with the same compact-first row retained. The explicit native Send now action still authorizes compaction. That action also exposed an incorrect HTTP 409 after compaction had already started; dispatch now reports acceptance with the queued follow-up instead of presenting a false failure that could invite a duplicate retry.

All 61 focused server tests pass, plus affected server/public-SDK typechecks, type-aware lint, formatting and builds. Earlier DB, domain and CLI suites remain separate evidence. Logs: `core-stop-race-red.log`, `core-queue-final.log`, and `core-queue-checks.log` under this thread's `bots-capabilities` storage. The earlier bounded source-runtime rejection smoke is unchanged evidence for native/plugin attribution, not proof of the new Stop race in a real provider. The [upstream follow-up](https://github.com/get-bb/bb/issues/6134#issuecomment-6782222327) preserves the remaining contract question.

## Native Tasks board

Current Tasks source is version 0.1.2, matching the running plugin. Its registered nav panel path is `tasks`; its route codec accepts a stable tracker project ID with `view=board`. Read-only browser navigation in BB 0.49.0 opened **Bots**, showed List/Board controls, an In Progress column and parent **BOTS-1: Build persistent Bots for BB**. The board shows one top-level task; subtask rendering was not exercised. The BB project was not rebound to this tracker, and no task or project association was changed.

Use the public host navigator in the future Bots UI:

```ts
navigate.toPluginPanel("tasks", {
  subPath: `${boardId}?view=board`,
});
```

Obtain `navigate` from `useBbNavigate()`. The board ID for this implementation tracker is `01M73NSQMGEYPWZ30WSR2CEYBP`; a configured bot board uses its own persisted tracker ID. Source evidence is [the registration](https://github.com/get-bb/bb/blob/9816b9420d76b47c3cbff99fcc620c38527f0388/plugins/tasks/app.tsx) and [route codec](https://github.com/get-bb/bb/blob/9816b9420d76b47c3cbff99fcc620c38527f0388/plugins/tasks/shell/routes.ts). Evidence: `15-tasks-board-navigation.json`. The observed browser URL is verification only; implementation must not construct BB URLs.

This proves an existing board target, not per-bot board creation, unavailable-Tasks behavior, narrow layouts or a replacement sidebar.

## Home archive and restart

A new fixture copied the earlier isolated probe data and attached a dedicated copy of its unmanaged non-Git home before launching the source server and daemon. Initial fixture path metadata was prepared before startup; the subsequent archive used the public thread archive API. A checkpoint marker was written only inside this dedicated test home. The test then archived its last live conversation, stopped the runtime, restarted both processes, and reread environment state and the marker hash.

Before archive, after archive and after restart, the environment reported the same path, `managed: false`, `status: ready` and no retirement instant. The marker hash was identical. After archive there were zero live threads in that home, and no new provider request was added across any copied thread. Both loopback test processes were stopped. Evidence: `16-home-archive-restart.json` and `home-archive-restart.py`.

The source [project-checkout provider](https://github.com/get-bb/bb/blob/9816b9420d76b47c3cbff99fcc620c38527f0388/plugins/environment-project-checkout/server.ts#L225) sets `retireGraceMs: null`; the core retirement path respects that policy. This is evidence for a single-host unmanaged project-checkout home across archive/restart. It does not establish multiple-host retention, managed worktree lifetime, host removal, home migration or arbitrary provider cleanup safety. Never delete a home as conversation cleanup.

## Review and remaining gates

[PR #82](https://github.com/galligan/bb-plugins/pull/82) merged as `bd44c203d7b26413c65efb8bb52fe4f874651a3e` after a fresh Devin analysis of head `5799fd01f91086f07f164b45963ba1ddd12a2c0d`, zero open dashboard findings, resolved GitHub review threads, green CI and current-head merge checks. The review was rerun through the dashboard's Review latest action; a GitHub mention alone had not triggered it. The original exploration branch and worktree changes were preserved.

The native compaction contract still needs upstream maintainer agreement before a feature PR under BB's CONTRIBUTING.md. The additive public compact-first payload needs compatibility review. Full live Stop/Send-now/retry/clear/restart coexistence, patched provider completion, fresh context reduction and within-turn behavior remain open. No admission or continuity requirement is waived by these narrower passes, and BOTS-4 remains behind BOTS-3.

Do not infer that the admission fix exists from SDK 0.6.138 alone: the failing baseline already had that version. Establish a released BB version containing the accepted contract, or a reviewed source build pinned to the required commit for development, before enabling the affected path. Production installation remains separately controlled.

The follow-up root verification passed with Bun 1.3.14 and Node 24.22.2, including format, lint, workflow lint, types, tests and build; Linear is excluded by repository policy. Its first run failed an unchanged Judge Git deadline test at `lib/sources/git.test.ts:422` (expected a dispatched request signal, observed none before deadline). That named test and the full rerun passed without code changes. Evidence: `followup-verification.log`, `judge-git-isolated.log`, and `followup-verification-retry.log`. No sibling test was changed or skipped.
