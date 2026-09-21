# 20260918-init — first working slice

**State (2026-09-18):** steps 1–5 are built. What the plan did not anticipate is the
composer banner, which grew out of step 4 and now carries the lineage view. What it
still calls for and has not been done:

- `merge` against a real remote. Exercised only to the guard; it has merged nothing.
  Deliberately so — the first real run should be observed, not a checkbox.
- `submit` is done: on 2026-09-19 it pushed a two-branch stack to
  `galligan/bb-plugin-graphite` and opened PRs #1 and #2, correctly based on each
  other. It also surfaced that `gt submit --no-interactive` always creates drafts,
  now recorded in `docs/agents/graphite.md`.
- `restack` and `sync` have run against the scratch stack, on a clean tree, on an
  untracked tree, and against the refusal path.
- The multi-machine `bb.host` path is built as a follow-up: Graphite reads and
  commands now run on the environment's enrolled host.
- The banner's hover pill was verified once by DOM inspection and one screenshot,
  not by an automated check. The lineage columns and elbows were compared against
  `gt ls` on a scratch stack with two columns and a nested fork. No UI is covered
  by tests.

Goal: a read-only Graphite stack view, exposed as a CLI command and an agent tool,
proven against a real two-branch stack.

Read [`../../../docs/agents/graphite.md`](../../../docs/agents/graphite.md) and the
`bb-plugin-dev` skill before starting. This plan assumes both.

## Sequence

Each step ends in a checkable condition. Do not start a step before the previous
step's condition holds.

### 1. Confirm the ref shape on a stacked branch

The blob shape at `refs/branch-metadata/<branch>` has been observed only on trunk.
Everything else in this plan depends on what a non-trunk branch records.

1. Create a scratch repository with a two-branch Graphite stack.
2. Read both refs with `git show-ref` and `git cat-file -p`.
3. Record the exact field names and types in `docs/agents/graphite.md`, replacing the
   "Unverified" section.

*Done when* `docs/agents/graphite.md` states the child-branch shape as verified, with
the observed JSON.

### 2. Build the ref reader

A pure module that takes a repository path and returns the stack graph.

- Read every `refs/branch-metadata/*` ref and its blob.
- Parse each blob. On a malformed blob, skip that branch and record the reason; do
  not throw.
- Build the parent/child graph. Detect and report a cycle rather than looping.
- Resolve each branch's actual head with `git rev-parse` and flag a branch whose
  recorded `branchRevision` differs.

Keep this module free of BB SDK imports and free of `gt`, so it is unit-testable
without a daemon.

*Done when* unit tests cover a linear stack, a branching stack, a stale branch, a
malformed blob, and a cycle — with no BB server running.

### 3. Join with environment state

Add the BB-side facts.

- Resolve the environment, then call `bb.sdk.environments.status({ environmentId,
  mergeBaseBranch })`.
- Attach working-tree state and ahead/behind counts to the branch the environment has
  checked out.
- When `status.outcome` is not `available`, report the stack without environment
  facts rather than failing.

*Done when* a snapshot renders for a real stack in a BB environment, including
working-tree state.

### 4. Expose two surfaces over one snapshot

- `bb graphite stack [--json]` via `bb.cli.register`.
- An agent tool via `bb.agents.registerTool` returning the same snapshot.

Both read one collector module. They must not be able to disagree.

Bound the output: combined stdout and stderr must fit 1,048,576 bytes, and the host
rejects a larger result atomically rather than clipping it.

*Done when* both surfaces return equivalent data for the same stack, and `--json`
parses.

### 5. Write verbs, one at a time

Only after step 4. Add in this order, each with its own guard:

1. `restack`
2. `submit`
3. `sync`
4. `merge`

Each verb MUST check `environments.status` first and refuse on a non-`clean` working
tree unless the caller explicitly asked to proceed. Each MUST invoke `gt`
non-interactively.

*Done when* each verb has been run against the scratch stack and its refusal path has
been exercised.

## Non-goals for this slice

- A UI panel. The CLI comes first; see the `bb-plugin-design` skill for the reason.
- Conflict resolution.
- Automatic merge policy.
- Multi-machine correctness was deferred from this initial slice and added in a
  later safety pass.

## Open questions

- What does `validationResult` range over? Only `TRUNK` has been observed. Find the
  values that indicate a branch needs a restack.
- Does Graphite write metadata refs for a branch it tracks but has never submitted?
- Does `gt` update `branchRevision` eagerly on `modify`, or lazily?

Record each answer in `docs/agents/graphite.md` as it is settled.
