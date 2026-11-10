# AGENTS.md

`bb-plugin-wt` registers the "Worktree+" environment provider (id `wt`).

- `server.ts` — registers the provider and maps bb core's `create` and `remove` onto the host entry. No git or file work happens here.
- `management.ts` — management RPC fetches and core-owned removal routing.
- `components/` — Worktrees panel, project settings, compact rows and removal confirmation. Project containers use the registry Collapsible with browser-local collapse state; attention reopens them on load. Metadata and icon actions follow the bundled Automations layout.
- `components/ui/` — vendored shadcn source from the `@bb` registry, pinned in `components.json` to the running bb release. Draw icons through its SDK wrapper; use host theme tokens and the shared toast, never a local Toaster.
- `lib/utils.ts` / `lib/portal-scope.ts` — vendored UI support only; no lifecycle decisions.
- `lib/overview.ts` — pure joins, state ordering and removal consequences.
- `lib/removal-request.ts` — routes user removal requests through core or the orphan host path.
- `lib/rescues.ts` / `lib/rescue-schema.ts` — host-only rescue discovery and its wire schema. The reader remains strict; host project listing suppresses the standard non-repository diagnostic and preserves other failures.
- `lib/display.ts` — branch-state wording shared by the CLI and UI.
- `app.tsx` — the frontend entry: the "Branch from:" control for the provider, built on bb's `experimental_BranchPicker`.
- `project-settings.ts` — validated per-project KV storage and settings RPCs; invalid rows never fail launches.
- `lib/project-settings.ts` — versioned settings schema and pure branch-setting precedence.
- `lib/read-setup-plan.ts` — host-only setup-plan reader shared by lifecycle and detection.
- `lib/detection.ts` / `lib/detection-schema.ts` — read-only, bounded setup display; shared file names only, never ignored config contents.
- `tests/` — SDK harness tests for launch and settings wiring, separate from SDK-free library tests.
- `lib/base-input.ts` — reads and writes that control's value.
- `host.ts` — the host entry. Thin wiring from the RPC contract to `lib/worktree.ts`.
- `lib/worktree.ts` — resolve, create and remove. Takes its root, data directory and reporter as arguments, so tests run it against a temporary repository.
- `lib/setup-plan.ts` — pure detected/effective script decisions.
- `lib/script-overrides.ts` — bounded per-step script mode schema shared by settings, host input and records.
- `components/script-settings.tsx` — project script mode editor and execution/storage disclosure.
- `lib/share.ts` — `.worktreeinclude` copying.
- `lib/remote.ts` — maps an `origin` URL to the folder segments a repo's worktrees live under.
- `lib/inspect.ts` — what removing a worktree would lose, and the rescue snapshot taken before removal.
- `lib/render.ts` — text for `bb wt list`.
- `lib/branch-name.ts` — the branch prefix rule.
- `lib/paths.ts` — worktree path layout and the containment check.
- `lib/fixture.ts` — test support: a throwaway git repository.

## Invariants

- Project script overrides MUST NOT apply when either bb hook is present; core owns both steps.
- Removal MUST read script overrides from the worktree record only, never current project settings. Existing records without scripts mean detected mode.

- Removal of a worktree with a bb environment MUST go through bb core, including retries. Only orphan records may call host removal directly.
- Never transmit ignored-file contents or their hashes in management RPCs.

- Run all git, filesystem and script work in the host entry. The server may be a different machine from the checkout.
- MUST NOT run `.bb-env-setup.sh` or `.bb-env-teardown.sh`. bb core runs them for every environment created with `ownsPath: true`; running them here would run them twice.
- MUST NOT delete a path that `isContained(root, path)` rejects. It compares real locations; a lexical check is not enough.
- MUST NOT delete a worktree folder by any means other than `git worktree remove`. If inspection, the rescue snapshot, or git fails, return `failed` and leave the folder.
- MUST NOT touch the path of a record whose `state` is `planned`. A record becomes `owned` only after `createWorktree` created the worktree or verified the one at that path is its own. A granted claim is not ownership.
- MUST NOT remove a worktree whose index has unresolved conflicts, that has a git operation in progress (rebase, merge, cherry-pick), or whose submodules hold unsaved work. None of these can be saved; return `failed`.
- MUST NOT remove what is at a recorded path unless `isLaunchWorktree` confirms it. The test is the `wt-launch` marker in the worktree's git directory, not the checked-out branch: work in a worktree moves between branches, and a path can be reused after a manual removal.
- MUST NOT write a shared file through a symlink that leads out of the worktree.
- Write records through `writeRecord` only. It replaces the file atomically.
- A stopped script is finished when its process group is gone, not when the shell exits.
- MUST NOT reset an existing branch (`git worktree add -B`). Removal keeps branches, so one may hold commits.
- MUST NOT replay a setup script whose record says `running`: its outcome is unknown.
- Inspect and save after cleanup scripts and process termination, immediately before deletion.
- MUST NOT derive a worktree's folder from the bb project name. Use `repoLocation`.
- Keep `inspectWorktree` read-only: no fetch, and no writes to the repository's objects or index.
- Write the per-path-key record before mutating the repository. `create` must be resumable and `remove` must work from the path key alone.
- Keep `lib/` free of `@get-bb/plugin-sdk` runtime imports other than the contract helpers, so `node --test` runs without a daemon.

## Read first

- The `bb-plugin-authoring` skill, `references/backend-events.md`, "Environment providers: core-owned lifecycle".
- The `bb-plugin-dev` skill for destructive hazards.
