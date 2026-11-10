# AGENTS.md

`bb-plugin-graphite` reads and drives Graphite stacks from BB.

The read path and write verbs are implemented. The September 2026 plan records historical live verification; it is not evidence of compatibility with a newer BB or Graphite release.

- `lib/stack/` — pure reader over Graphite's metadata. No BB SDK, no `gt`, unit
  tested without a daemon.
- `host.ts`, `lib/host-stack.ts` — read the workspace host's Graphite metadata.
- `lib/current-stack.ts` — joins the host's stack with BB threads.
- `lib/gt.ts`, `lib/verbs.ts` — host-side `gt` execution and the server-side guard.
- `server.ts` — the RPC, `bb graphite …`, and the `graphite_stack` agent tool.
- `app.tsx`, `components/stack/` — the composer banner.

## Read first

- [`docs/agents/graphite.md`](docs/agents/graphite.md) — version-scoped metadata and CLI findings. Its BB inventory is historical, not a current SDK reference.
- [Plugin patterns](../../docs/dev/plugin-patterns.md) — host boundaries, surface choices, and the distinction between current SDK APIs and this plugin's compatibility code.
- The available `bb-plugin-authoring` skill — current public SDK contracts; consult `references/git-reads.md` when migrating environment status or diff reads.
- [`.agents/plans/20260918-init/`](.agents/plans/20260918-init/) — historical
  first-slice plan and verification notes; check current code and this file for
  present behavior.

## Invariants

- Read stack topology from the Graphite metadata database at
  `<git-common-dir>/.graphite_metadata.db`. MUST NOT parse `gt` output. MUST NOT read
  `refs/branch-metadata/*`; those refs are obsolete as of Graphite CLI `1.8.6`.
- Read branch, head SHA, and dirty state through BB's environment-aware Git service. This package's current `lib/current-stack.ts` calls the retired `bb.sdk.environments.status` compatibility API; new SDK work should use the Git plugin's `workspaceStatus` contract. Preserve response validation and write guards when migrating. MUST NOT shell out to `git status` or `git rev-parse` for facts the service already returns.
- MUST NOT invoke `gt` in a form that can prompt. See the command reference in
  `docs/agents/graphite.md`.
- MUST NOT run a destructive `gt` or `git` operation without first checking environment Git status. Refuse when `workspace.workingTree.state` is `dirty_uncommitted`, `committed_unmerged`, or `dirty_and_committed_unmerged`, and when it is a state this list does not name. Allow `clean` and `untracked`. The predicate is `blocksWrite` in `lib/verbs.ts`; preserve its allow-list when migrating the status API.
- Run repository reads and `gt` on the environment's host through the host client from `bb.hosts`.
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
- Test against a separate BB instance, not the live one. Follow [verification](../../docs/dev/verification.md); the linked September 2026 setup notes are historical and their flags and runtime paths need verification before reuse.
