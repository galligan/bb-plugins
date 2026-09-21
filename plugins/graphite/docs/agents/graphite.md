# Graphite for agents

What a BB plugin can read from Graphite, what it must shell out for, and where the
gaps are.

Verified 2026-09-18 against Graphite CLI `1.8.6`. Re-verify the metadata schema and
flag behavior when the CLI updates.

## Read the stack from `.git/.graphite_metadata.db`

Graphite CLI `1.8.6` stores stack topology in a SQLite database inside the git
directory. It does **not** use git refs. Verified 2026-09-18 in a scratch repository
built with `gt init` plus three `gt create` calls, and cross-read against 21 tracked
repositories under `~/Developer` (413 rows).

- Resolve the database path as `git rev-parse --git-common-dir` + `/.graphite_metadata.db`.
  MUST NOT assume `<repo>/.git`.
- A git worktree has no metadata of its own. `--git-common-dir` from inside a worktree
  resolves to the main repository's `.git`, and `gt` in that worktree reads the same
  database. Verified.
- Open the database read-only. `journal_mode` is `delete`; there is no `-wal` or `-shm`
  sidecar.
- Read the trunk branch name from `<git-common-dir>/.graphite_repo_config`, field
  `trunk`. MUST NOT infer trunk from `validation_result`; see below.

### `refs/branch-metadata/*` is obsolete. Do not read it.

An earlier revision of this file told you to read stack topology from
`refs/branch-metadata/<branch>`. That is wrong for `1.8.6`.

- `gt init`, `gt create`, `gt modify`, `gt restack`, `gt track`, and `gt ls` in a fresh
  repository wrote **zero** `refs/branch-metadata/*` refs. Verified.
- Of 21 metadata-carrying repositories on this machine, 3 still have a
  `refs/branch-metadata/*` entry, all in `packed-refs`, all left by an older CLI.
- Those surviving refs disagree with the database. In `~/Developer/outfitter/stack`,
  `refs/branch-metadata/main` records two children and `branchRevision fcbbea62`;
  the database records `children []` and `branch_revision abc84593`. The `packed-refs`
  file predates `.graphite_metadata.db` by two days.
- Treat any `refs/branch-metadata/*` ref as stale legacy data. MUST NOT read it.

### Schema

```sql
CREATE TABLE "branch_metadata" (
  "branch_name"            text not null primary key,
  "parent_branch_name"     text,
  "parent_branch_revision" text,
  "last_submitted_version" text,
  "state"                  text,
  "children"               text,
  "branch_revision"        text,
  "validation_result"      text,
  "parent_head_revision"   text
);
CREATE INDEX "idx_branch_metadata_parent" on "branch_metadata" ("parent_branch_name");
```

Every nullable column is SQLite `NULL` or `text`. Read each one as
`string | null`; never assume a string.

The database also carries `kysely_migration` and `kysely_migration_lock`. All 21
repositories report the same three migrations:
`20260211_initial_schema`, `20260212_add_validation_columns`,
`20260220_add_parent_head_revision`. Treat a fourth migration name as a signal to
re-verify this section.

### Example rows

Trunk and two stacked children, from the scratch repository:

```
branch_name: main            parent_branch_name: NULL
  parent_branch_revision: NULL   parent_head_revision: NULL
  branch_revision: 1e430488…     validation_result: TRUNK
  children: ["feat-a"]           state: NULL   last_submitted_version: NULL

branch_name: feat-a          parent_branch_name: main
  parent_branch_revision: 1e430488…  parent_head_revision: 1e430488…
  branch_revision: 1e430488…         validation_result: VALID
  children: ["feat-b","feat-c"]      state: NULL   last_submitted_version: NULL

branch_name: feat-b          parent_branch_name: feat-a
  parent_branch_revision: 1e430488…  parent_head_revision: 1e430488…
  branch_revision: 3d044850…         validation_result: VALID
  children: []                       state: NULL   last_submitted_version: NULL
```

A child branch records its parent by name and by revision. A trunk row records
neither.

### Field semantics

- `branch_name` — primary key. The git branch name, not a ref path.
- `parent_branch_name` — the branch this one is stacked on. `NULL` on trunk **and** on
  a branch `gt` has seen but does not track.
- `parent_branch_revision` — the parent commit this branch was last stacked onto. When
  it differs from the parent's actual head, the branch needs a restack. `gt ls` prints
  this as `(needs restack)`.
- `parent_head_revision` — the parent's head **as `gt` last observed it**, not as git
  reports it now. Added by migration `20260220`; `NULL` on 10 of 243 child rows.
  MUST NOT use `parent_branch_revision != parent_head_revision` as the needs-restack
  test: both values are `gt`'s cache, so the comparison misses a parent that moved
  since `gt` last ran. Verified — a raw `git commit` on a parent left
  `parent_branch_revision == parent_head_revision` on its child while `gt ls` printed
  `(needs restack)` for that child. Across 21 repositories the cached comparison
  disagrees with the live one on 73 of 243 child rows.
- `branch_revision` — the head commit `gt` last observed for this branch.
- `children` — JSON array of branch names. **Not authoritative.** 10 of 413 rows across
  21 repositories disagree with the parent pointers, in both directions: `children`
  naming a branch whose row points elsewhere, and a row whose parent does not list it.
  Build the graph from `parent_branch_name` and report a `children` disagreement as a
  finding.
- `validation_result` — observed values: `TRUNK`, `VALID`, `BAD_PARENT_NAME`,
  `BAD_PARENT_REVISION`, `INVALID_PARENT`, and `NULL`. `NULL` appears on rows written
  before migration `20260212`, including on trunk rows. Do not treat this column as an
  exhaustive enum; carry the raw string.
- `state` — `NULL` in all 413 rows. What writes it is unverified.
- `last_submitted_version` — JSON `{"headSha":…,"baseSha":…,"baseName":…}` or `NULL`.
  Present only after `gt submit`.

### A row is not proof of tracking

- `git checkout -b x` writes no row. Verified.
- The next `gt` command in that repository inserts a row for `x` with
  `parent_branch_name NULL` and `validation_result BAD_PARENT_NAME`. Verified.
- `gt track x` sets `parent_branch_name` and `validation_result VALID`. Verified.
- Treat a branch as tracked when `parent_branch_name` is non-`NULL`, or when its name
  equals the `trunk` field of `.graphite_repo_config`.
- MUST NOT treat `validation_result = 'TRUNK'` as the trunk test. Trunk rows with
  `validation_result NULL` exist in 4 of 21 repositories.

### Derive staleness

The database is `gt`'s last observation, not the repository. Compare each row against
git:

```sh
git for-each-ref --format='%(refname:short) %(objectname)' refs/heads/
```

- `branch_revision` differs from the branch's actual head → `gt`'s recorded view is
  behind the repository.
- `parent_branch_revision` differs from **the parent branch's actual head** → the
  branch needs a restack. Compare against git, never against `parent_head_revision`.

`gt` refreshes `branch_revision` silently on **any** invocation, including `gt ls`.
Verified: a raw `git commit` left `branch_revision 42eed4ce` against an actual head of
`be6c1044`; running `gt ls` rewrote the row to `be6c1044` and printed nothing about it.
A reader that never invokes `gt` is therefore the only thing that can observe this
divergence — and invoking `gt` destroys the evidence.

### Read before you write

A `gt` write verb refreshes `branch_revision` and `parent_head_revision` as a side
effect, so it destroys the evidence a snapshot is built from.

- Capture the snapshot **before** invoking any `gt` verb in the same operation.
- MUST NOT re-read the database after a `gt` verb and present the result as the
  pre-operation state.

### Treat the migration set as a tripwire

The reader asserts the applied migration ids on every read.

- On an unexpected or a missing migration id, report the id and keep serving the
  snapshot. The `select` names its columns, so an additive migration cannot silently
  change what is read, and a destructive one fails the read outright.
- MUST NOT fall back to parsing `gt` output or to `refs/branch-metadata/*`.

### Answers to the plan's open questions

- **What does `validation_result` range over?** `TRUNK`, `VALID`, `BAD_PARENT_NAME`,
  `BAD_PARENT_REVISION`, `INVALID_PARENT`, `NULL`. Observed, not exhaustive. Which
  values mean "needs a restack" is **unverified**; `gt ls` derives `(needs restack)`
  from the revision comparison above, not from this column — a branch reading `VALID`
  printed `(needs restack)`.
- **Does Graphite write metadata for a branch it tracks but has never submitted?** Yes.
  A branch created with `gt create` and never submitted has a full row, with
  `last_submitted_version NULL`.
- **Does `gt` update `branch_revision` eagerly on `modify`?** Yes. `gt modify -a` wrote
  the new head into the row in the same invocation.

### Still unverified

- What writes `state`, and what its values are.
- Whether `gt` holds a write lock long enough to exhaust a 2-second SQLite busy
  timeout. The reader sets one; no contention failure has been observed.
- What `gt` does with a corrupt database.
- The database's behavior across a `gt sync` that deletes merged branches: whether rows
  are deleted or left orphaned.
- Whether Graphite's own daemon or the VS Code extension writes to the same file.

## Do not shell out for worktree facts

`bb.sdk.environments.status({ environmentId, mergeBaseBranch })` returns the branch
name, exact head SHA, working-tree state, and ahead/behind counts against the merge
base. Use it instead of `git rev-parse` and `git status`.

See the `bb-plugin-dev` skill for the full response shape.

## Write through the `gt` CLI

`node:child_process.execFile` runs inside the plugin's `bb.host` entry on the
environment's enrolled machine. Pass `cwd`, a timeout, and a `maxBuffer`, and
resolve a result object rather than throwing.

Two rules:

- Run reads and writes on `environment.hostId`; a path supplied by BB names that
  host's filesystem, not necessarily the BB server's.
- Resolve `gt` on the workspace host. It may be absent from that host's `PATH`.

## Command reference

### No machine-readable output exists

- `gt log` has three forms: `gt log`, `gt log short` (alias `gt ls`), and
  `gt log long` (alias `gt ll`). None emit JSON.
- `gt ll` ignores all options and renders a commit-ancestry graph of all branches.
- `gt status` is **not a Graphite command**. It passes through to `git status` and
  reports working-tree state, not stack topology.

### Non-interactive invocation

An agent MUST NOT invoke `gt` in a form that can prompt.

- Pass `--no-interactive` to disable prompts, pagers, and editors.
- Pass `-f` to `undo`, `absorb`, `delete`, `sync`, and `abort`.
- Pass `--quiet` where minimal output is wanted; it implies `--no-interactive`.
- Pass `--message` / `-m` to `gt create` and `gt modify` so the command never waits
  on an editor.

### `gt submit --no-interactive` creates drafts

Verified 2026-09-19 against Graphite CLI `1.8.6`, submitting a two-branch stack to
`galligan/bb-plugin-graphite`.

- `gt submit --no-interactive` prints `Running in non-interactive mode. Inline
prompts to fill PR fields will be skipped and new PRs will be created in draft
mode.` and creates every new PR as a draft.
- It takes the PR title and body from the branch's commit message. There is no
  prompt to skip past, so the command cannot hang.
- It sets each PR's base to its Graphite parent, so a stack arrives on GitHub
  already stacked. Verified: `#2 → fix/usage-text-matches-guard`, `#1 → main`.
- Without `--publish`, newly created PRs are drafts. A resubmission can also update
  existing PRs; its effect on an existing PR's readiness has not been verified.
  Check the PR's state before reporting it or changing its readiness.
- `gt submit -p` / `--publish` publishes the PRs being submitted. `-d` / `--draft`
  forces drafts explicitly, `-u` / `--update-only` pushes and updates only branches
  that already have a PR, and `-m` / `--merge-when-ready` marks each PR to merge once
  its checks pass. Read from `gt submit --help` at `1.8.6`.
- `bb.sdk.environments.markPullRequestReady` is the other way to take a PR out of
  draft, without `gt`.

### Corrections to widely-repeated guidance

Two errors appear in `~/.config/claude/rules/graphite.md`. Do not inherit them.

- `gt merge --confirm` does **not** skip prompts. `-c, --confirm` _asks_. Using it
  non-interactively fails with `Cannot perform interactive operation in
non-interactive mode`. Use `--no-interactive`.
- `gt status` does not emit structured JSON with stack parentage. It is a `git
status` passthrough.

### Worktree rule

MUST NOT run `gt sync` inside a git worktree. Run `git fetch origin` in the
worktree, then `gt restack`.

## Gaps in BB

Verified against BB `0.43.1` and the plugin store on 2026-09-18:

- BB has no native Graphite support. Zero matches in the server build.
- No Graphite plugin exists in the store.
- No Jujutsu plugin. No GitButler plugin.
- `GitHub Stack` (store name; `smsunarto/bb-plugins/plugins/gh-stack`) wraps the
  `gh stack` CLI from a thread panel. It is the closest working reference for a
  stacking plugin in BB.
- `bb.sdk.environments` provides `pullRequest`, `markPullRequestDraft`,
  `markPullRequestReady`, and `mergePullRequest`. There is no restack, rebase, or
  submit primitive.
- `bb.sdk.terminals` is an interactive PTY, not exec-and-capture. It is not the path
  for running `gt`.
- The installed BB host runtime uses Node `24.15.0`. `node:sqlite` is available
  there unflagged, so the host entry can read Graphite's metadata database with
  no native dependency. Verified 2026-09-18 with `ELECTRON_RUN_AS_NODE=1`.
