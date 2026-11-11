# Capability follow-up

**Historical investigation; current disposition:** Matt directed plugin implementation without maintainer changes. BOTS-18 is deferred/non-blocking; no further upstream pings or waiting for releases. Preserve the prototype/evidence/draft without merging/deploying it. Old statements below that BOTS-4 waits for BOTS-3/upstream alignment are superseded by [the implementation plan](plan.md) and [support boundary](support-boundary.md).

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

Before archive, after archive and after restart, the environment reported the same path, `managed: false`, `status: ready` and no retirement instant. The marker hash was identical. After archive there were zero live threads in that home, and no new provider request was added across any copied thread. Both loopback test processes were stopped. The corrected run explicitly verified a connected test host, registered Codex provider and both live runtime processes before archive and after restart. Evidence: `16-home-archive-restart-verified.json` and `home-archive-restart-verified.py`.

The source [project-checkout provider](https://github.com/get-bb/bb/blob/9816b9420d76b47c3cbff99fcc620c38527f0388/plugins/environment-project-checkout/server.ts#L225) sets `retireGraceMs: null`; the core retirement path respects that policy. This is evidence for a single-host unmanaged project-checkout home across archive/restart. It does not establish multiple-host retention, managed worktree lifetime, host removal, home migration or arbitrary provider cleanup safety. Never delete a home as conversation cleanup.

## Runtime readiness correction

The first source-runtime harness treated the probe plugin loading as readiness. A later check found that the source daemon had exited because its built CLI runtime was missing, and the probe could load before the Codex provider registered. The initial server rejection results remain valid; the earlier claim of daemon participation was overstated. The initial files are preserved and qualified rather than counted as full-runtime passes.

After building the required CLI runtime, the harness now checks both processes are alive, the public host API reports `connected`, and the public provider list includes Codex before making assertions. Native/plugin rejection and home archive/restart both passed again with that readiness contract. Evidence: `18-source-runtime-verified.json`, `source-runtime-verified.py`, and the corrected home files above. Both checks added zero provider requests across all copied threads and stopped their temporary processes.

A third real-runtime check held a plugin-attributed compact-before-send request, restarted server and daemon, and observed the same queued row ID, content, `originPluginId` and `compact-first` intent. Public cancellation then removed the row. Both startup rounds met the strict readiness contract and no provider request was added. Evidence: `17-queue-restart.json` and `queue-restart.py`; its first setup attempt is preserved as `17-queue-restart-attempt1.json`. These are request retention/cancellation checks, not proof of successful provider compaction or every recovery race.

The corrected checks used core source head `05f2aa9b9c1e0a7eeb18c3f033860c8ae1b917cd` with proposed source SDK 0.6.139. The SDK version gate, package/constant consistency test, app consumer typecheck and affected server/public-SDK builds pass. This source version has not been published or installed into production.

## Review and remaining gates

[PR #82](https://github.com/galligan/bb-plugins/pull/82) merged as `bd44c203d7b26413c65efb8bb52fe4f874651a3e` after a fresh Devin analysis of head `5799fd01f91086f07f164b45963ba1ddd12a2c0d`, zero open dashboard findings, resolved GitHub review threads, green CI and current-head merge checks. The review was rerun through the dashboard's Review latest action; a GitHub mention alone had not triggered it. The original exploration branch and worktree changes were preserved.

The follow-up [PR #93](https://github.com/galligan/bb-plugins/pull/93) also merged after clean Devin review and green current-head checks. The core patch is now a [draft review PR on Matt's fork](https://github.com/galligan/bb/pull/3), targeting the pinned upstream base. Its initial comment-rule finding was fixed, replied to and resolved; fresh dashboard review and commit status at `05f2aa9b9` show no open findings. Remote CI remains queued for the configured Blacksmith runner, so it stays draft. No runner configuration or upstream feature PR was changed.

The native compaction contract still needs upstream maintainer agreement before a feature PR under BB's CONTRIBUTING.md. Matt subsequently chose minimum-version-only support for the new public compact-first payload; see [support boundary](support-boundary.md) for existing manifest gates and pre-upgrade-snapshot rollback. Actual released floors remain unselected, and older readers do not gain a retroactive guard. Full live Stop/Send-now/retry/clear/restart coexistence, patched provider completion, fresh context reduction and within-turn behavior remain open. No admission or continuity requirement is waived by these narrower passes, and BOTS-4 remains behind BOTS-3.

Do not infer that the admission fix exists from SDK 0.6.138 alone: the failing baseline already had that version. Establish a released BB version containing the accepted contract, or a reviewed source build pinned to the required commit for development, before enabling the affected path. Production installation remains separately controlled.

The follow-up root verification passed with Bun 1.3.14 and Node 24.22.2, including format, lint, workflow lint, types, tests and build; Linear is excluded by repository policy. Its first run failed an unchanged Judge Git deadline test at `lib/sources/git.test.ts:422` (expected a dispatched request signal, observed none before deadline). That named test and the full rerun passed without code changes. Evidence: `followup-verification.log`, `judge-git-isolated.log`, and `followup-verification-retry.log`. No sibling test was changed or skipped.
