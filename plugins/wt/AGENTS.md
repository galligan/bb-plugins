# AGENTS.md

`bb-plugin-wt` registers the "Worktrees+" environment provider (id `wt`).

- `server.ts` — registers the provider and maps bb core's `create` and `remove` onto the host entry. No git or file work happens here.
- `host.ts` — the host entry. Thin wiring from the RPC contract to `lib/worktree.ts`.
- `lib/worktree.ts` — resolve, create and remove. Takes its root, data directory and reporter as arguments, so tests run it against a temporary repository.
- `lib/setup-plan.ts` — pure decision of where setup and cleanup scripts come from.
- `lib/share.ts` — `.worktreeinclude` copying.
- `lib/remote.ts` — maps an `origin` URL to the folder segments a repo's worktrees live under.
- `lib/inspect.ts` — what removing a worktree would lose, and the rescue snapshot taken before removal.
- `lib/render.ts` — text for `bb wt list`.
- `lib/paths.ts` — worktree path layout and the containment check.
- `lib/fixture.ts` — test support: a throwaway git repository.

## Invariants

- Run all git, filesystem and script work in the host entry. The server may be a different machine from the checkout.
- MUST NOT run `.bb-env-setup.sh` or `.bb-env-teardown.sh`. bb core runs them for every environment created with `ownsPath: true`; running them here would run them twice.
- MUST NOT delete a path that `isUnder(root, path)` rejects.
- MUST NOT remove a worktree with uncommitted or untracked files before `saveRescueSnapshot` succeeds.
- MUST NOT derive a worktree's folder from the bb project name. Use `repoLocation`.
- Keep `inspectWorktree` read-only: no fetch, no writes.
- Write the per-path-key record before mutating the repository. `create` must be resumable and `remove` must work from the path key alone.
- Keep `lib/` free of `@get-bb/plugin-sdk` runtime imports other than the contract helpers, so `node --test` runs without a daemon.

## Read first

- The `bb-plugin-authoring` skill, `references/backend-events.md`, "Environment providers: core-owned lifecycle".
- The `bb-plugin-dev` skill for destructive hazards.
