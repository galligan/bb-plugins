# Revised skill and real-stream acceptance

This is a bounded follow-up to [#73](https://github.com/galligan/bb-plugins/issues/73) and the real-stream portion of [#71](https://github.com/galligan/bb-plugins/issues/71). It does not cover every Rex feature. The starting source is `0c962d6444c2d7a25a58126f712414a65e494d2a`, after the implementation and harness campaigns. A live run must record its actual tested head and installed build.

## Offline evidence

`lib/terminal-skill.test.ts` executes the shipped skill's quoted loop in installed bash, zsh, and fish with user startup files disabled. It checks exact output and successful exit, and separately checks that a standalone `export` reaches a child process. Missing shells are explicit skips, not passes. These checks use subprocesses, never Rex sessions. They do not reproduce interactive prompts, key submission, process reporting, or an agent deciding to use the skill.

The existing server harness covers target creation, instructions, target selection, archive/delete listeners, and reload catch-up. The frontend harness covers registration, connecting, and failed states. Neither establishes that the current Rex server's snapshot decodes and draws through BB's live HTTP route.

## Live slot and resources

The parent coordinates the slot. Until released, do not install, reload, change settings, open a Rex tab, or call `bb rex target` on Dev. Worktree+ has the first slot; Judge is reserved next. Rex also needs the disposable-thread prerequisite resolved below.

The proposed run uses:

- The already-running isolated Dev BB, identified by its instance README. Verify its exact `dataDir` with the explicitly targeted CLI before each mutation phase. Clear inherited `BB_CLI`, thread, environment, and project context as the README prescribes. Its source build is not evidence about the released binary.
- One disposable project and nonarchived thread on Dev's designated host, with a temporary workspace containing only synthetic test data. Ordinary creation starts dispatch; it is not an idle-thread API. The scheduled-create/cancel alternative below requires parent release before use.
- One uniquely labelled Rex test session, `rex-dev-acceptance-<run-id>`, with only this test's windows. Never use the default `bb` session. Read labels for inventory only; attach, capture, stream, and type only in recorded test-owned IDs.
- One Dev Rex plugin installation from this lane's built package, only after release. Record any existing installation and `sessionLabel` before changing them. A conflicting existing Dev Rex installation requires parent coordination. Preserve the Dev theme and existing provider conversation.
- One browser tab and at most one active stream. Allow ten minutes for the run; every synthetic command must finish within five seconds. No provider call, credentials, external messaging, shared-server restart, or remote Git mutation is part of the scenario.

## Execution and evidence

1. **Prepare:** verify Dev identity, record source head, build result, plugin source, setting, Rex CLI/server versions and process-response shape. Discover the Rex socket without autostart. If no Rex server is available, report that prerequisite; do not start or reconfigure one. Set only Dev's Rex session label to the unique test label. Record every resource ID created.
2. **Target:** invoke the explicitly targeted Dev `rex target --thread <test-thread> --json`. Require the test session label and an owned window. Resolve it twice and assert identical session/window/block IDs. Open only that thread's Rex tab and confirm it resolves the same window.
3. **Execute:** capture the empty prompt and inspect `block call ... process` using explicit session and block IDs with autostart disabled. Follow the shipped skill's heredoc loop exactly. Capture evidence of the three output lines and a returned prompt. Echoed input alone is not success. Record process information before and after; do not infer it from a successful send response.
4. **Stream:** verify that the same output appears in the Dev Rex tab without refreshing. Send a second finite command with a unique output marker and verify that marker in both CLI capture and the tab. This separates initial snapshot decoding from subsequent live output. A screenshot and sanitized capture should show the marker, not unrelated sessions or conversation content.
5. **Input:** in the test pane only, type one finite marker command through the tab and verify its output through CLI capture. Observe the current Dev theme without changing it. Close and reopen the tab once to verify a fresh snapshot shows prior output; this is not a server restart or a stream-resume test.
6. **Clean up:** save captures, screenshots, resource IDs, and test results before archive or cleanup. Verify Dev identity again. Close the test tab/stream, archive only the disposable thread, and verify that its recorded owned window closes. Restore the prior Dev Rex setting and installation state through supported operations agreed for the slot. Remove only the session created for this run, after checking it contains no non-test windows; this is test-resource cleanup, not plugin lifecycle behavior. Do not retire an environment backing an installed plugin path. Do not stop Rex. Report any leftover resource by ID instead of broad cleanup.

Keep pass/fail/not-run evidence for each step. Abort on an unexpected target or ownership mismatch. After an uncertain mutation, inspect the recorded resource before retrying.

## Disposable-thread prerequisite

Read-only inspection of Dev source `365d7c5237ae270be0555b5b44ea61020252713e` found the following supported path. This is a proposal for parent decision, not live authorization:

- `apps/cli/src/commands/thread/spawn.ts:415` exposes `--send-at`; normal creation requires a prompt and attempts initial dispatch. Empty input is not a dormant-thread mechanism; the empty-fork tests still enqueue `thread.start`.
- `packages/server-contract/src/api/threads.ts` documents future `sendAt` as pending with no turn or environment work. `apps/server/src/services/threads/dispatch-attempt.ts:514` returns a time wait before admission/provisioning. Creation still performs host readiness, model/catalog resolution, placement selection, and message-dispatch hooks before that wait. It is not free of all provider-related operations; the inspected core path avoids inference and environment provisioning.
- `bb thread queue delete <threadId> <messageId> --json` calls the public queued-message delete route (`apps/cli/src/commands/thread/organization.ts:592`, `apps/server/src/routes/threads/actions.ts:423`). `packages/db/src/data/queued-thread-messages.ts:2646` deletes only the queue row transactionally and notifies queue changes; it does not archive or delete the thread. Cancellation emits a plugin notification, so installed hook behavior must also be considered.
- `apps/server/src/services/threads/queued-message-dispatch.ts:547` enumerates persisted due queue rows. A deleted row has no clock trigger. Retention of the pending thread and absence of automatic resurrection are source-derived conclusions, not a combined executed schedule/cancel/sweep result.
- Existing Dev tests `public-thread-pending-followup.test.ts` and the `creates and deletes thread queued messages` case in `public-thread-data.test.ts` passed: three selected tests, 69 filtered skips. They separately establish pending scheduled creation without events or `thread.start`, and deletion of the persisted queue row. They do not cover the combined scenario or a new environment. The first attempt under Node 24 could not load Dev's existing ABI-147 SQLite binding; Node 26.12.1 matched it and passed without dependency changes. This is separate from the plugin repository's Node 24 gates.
- Rex's server harness now tests a pending thread with `environmentId: null`: target creation succeeds and repeated lookup returns the same owned window. Without an environment, its shell uses Rex's default directory; run only synthetic commands there, or explicitly change to the disposable workspace.

If the parent releases this alternative, set an explicit title and synthetic prompt, choose an absolute schedule timestamp 24 hours ahead, and record that timestamp. Immediately list that thread's queue and delete the exact initial-message ID through the supported command. Do not activate Rex until a second queue list is empty, the thread remains nonarchived, and its event log shows zero turn requests and zero started turns. The time bound is a buffer for cancellation, not the safety proof. Never invoke queue `send` or reschedule the row to now.

If create or cancellation has an uncertain result, inspect the disposable project's threads and the exact queue row before retrying. If cancellation fails, stop the Rex scenario and notify the parent immediately; remove the exact queued request through the supported API or delete only the newly created disposable thread if that cleanup was released. Verify the queue is empty afterward. Do not leave a pending scheduled message after the slot, and do not use a database write as cleanup. Retain the environment and source path that supplies the installed plugin. A final queue/event check belongs in the saved evidence before archiving.

## Explicit gaps

- Fresh-agent adoption in #73 remains unverified without a separately released provider run. Following the skill manually and seeing staged text do not establish adoption.
- The shell subprocess tests do not prove bash/zsh continuation prompts or interactive `export` submission in Rex. Those require dedicated panes with the chosen shells and a separately bounded extension of the scenario.
- One installed Rex version does not establish compatibility with other process-response versions.
- Desktop layout, alternate themes, coarse pointers, server restart persistence, and the other #71 checks remain outside this run.

## Issue triage at the starting source

All GitHub issues #61–75 were open when inspected. Open status alone does not mean their original coverage descriptions still match the code:

- #61–64, #67–69: mouse/input/scrolling/renderer/resume/multi-pane/remote-host requests are outside this bounded acceptance lane.
- #65: the README already has a WASM upgrade recipe; the requested ABI-layout comparison is a separate remaining item.
- #66 and #70: history and lifecycle edge cases remain separate work; do not broaden this run to destructive or large-history probes.
- #71 and #73: selected for the limited scenario above, with each remaining gap retained explicitly.
- #72: server and frontend harnesses now exist. Inspect individual cases before adding coverage; do not recreate the original missing-harness task or claim all retry/data-stream behavior is covered.
- #74–75: isolated-instance infrastructure and shared CI reliability belong to the shared tooling owner.
