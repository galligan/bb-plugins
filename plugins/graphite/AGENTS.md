# AGENTS.md

`bb-plugin-graphite` reads and drives Graphite stacks from BB.

Status: the read path and write verbs are built. `merge` has not yet been exercised
against a real remote.

- `lib/stack/` — pure reader over Graphite's metadata. No BB SDK, no `gt`, unit
  tested without a daemon.
- `host.ts`, `lib/host-stack.ts` — read the workspace host's Graphite metadata.
- `lib/current-stack.ts` — joins the host's stack with BB threads.
- `lib/gt.ts`, `lib/verbs.ts` — host-side `gt` execution and the server-side guard.
- `server.ts` — the RPC, `bb graphite …`, and the `graphite_stack` agent tool.
- `app.tsx`, `components/stack/` — the composer banner.

## Read first

- [`docs/agents/graphite.md`](docs/agents/graphite.md) — what Graphite exposes, how to
  read the stack from metadata, which `gt` invocations are safe, and the gaps in BB.
  Written for agents.
- The `bb-plugin-dev` skill — verified BB SDK behavior, destructive hazards, and
  multi-machine rules. Covers what the built-in `bb-plugin-authoring` skill does not.
- The `bb-plugin-design` skill — scope, surface choice, and composition preferences.
- [`.agents/plans/20260918-init/`](.agents/plans/20260918-init/) — the current build
  plan and its done-conditions.

## Invariants

- Read stack topology from the Graphite metadata database at
  `<git-common-dir>/.graphite_metadata.db`. MUST NOT parse `gt` output. MUST NOT read
  `refs/branch-metadata/*`; those refs are obsolete as of Graphite CLI `1.8.6`.
- Read branch, head SHA, and dirty state from `bb.sdk.environments.status`. MUST NOT
  shell out to `git status` or `git rev-parse` for facts that call already returns.
- MUST NOT invoke `gt` in a form that can prompt. See the command reference in
  `docs/agents/graphite.md`.
- MUST NOT run a destructive `gt` or `git` operation without first checking
  `environments.status`. Refuse when `workspace.workingTree.state` is
  `dirty_uncommitted`, `committed_unmerged`, or `dirty_and_committed_unmerged`, and
  when it is a state this list does not name. Allow `clean` and `untracked`.
  A rebase does not touch untracked files, and refusing there only teaches the
  operator that `--force` is routine. The predicate is `blocksWrite` in
  `lib/verbs.ts`.
- Run repository reads and `gt` on the environment's host through `bb.host`.
- Resolve the `gt` binary path on that host. Do not assume it is on `PATH`.
- Refuse `gt sync` in a linked worktree. An explicit thread must resolve to that
  project's environment before any write verb runs.

## Conventions

- `docs/agents/` is for agent consumption. Write it in Agentish: one instruction per
  bullet, conditions before actions, named targets, no vague qualifiers.
- `docs/` otherwise is for people.
- State what is verified and what is not. When a fact comes from a specific version,
  name the version.
- Prefer a CLI command over a UI panel until a decision exists that a human cannot
  make from `--json` output. The stack banner earns its place: position and lineage
  are not readable from a JSON array.
- Keep a surface thin. Anything a second surface could want belongs in `lib/`.

## Verification

- `bb plugin build` must succeed before install.
- Test against a separate BB instance, not the live one. See
  [`.agents/plans/20260918-init/testing-setup.md`](.agents/plans/20260918-init/testing-setup.md).
