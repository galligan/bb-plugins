# Graphite for BB

Read and drive [Graphite](https://graphite.dev) stacks from BB.

> **Status: the read path and the write verbs work.** Not yet released through
> the BB Community marketplace.

## Why

BB has no Graphite support — nothing native, and nothing in the plugin store. Stacked
work is currently driven by hand in a terminal, which means an agent coordinating a
stack has to shell out, parse human-readable output, and guess at state.

## What works

```sh
bb graphite stack            # the stack around the checked-out branch
bb graphite stack --json     # the same snapshot, for agents
bb graphite restack | submit | sync | merge
```

Plus a `graphite_stack` agent tool and a compact control in the thread header.
The header shows the current branch's stack position; hover for status and click
to open a side-panel tab with lineage, restack warnings, and threads on each
branch. On narrow screens, the control shows only its icon. It appears only when
the current branch belongs to a multi-branch stack.

**Reads the stack from stored state, not from CLI output.** Graphite keeps its
topology in a SQLite database inside your git directory, so the stack graph, each
branch's recorded head, and its validation state are all available as structured
data. No output parsing, no interactive prompts, no auth.

**Reports what the CLI cannot.** Because the recorded head and the actual head are
both readable, the plugin can tell you when Graphite's view of a branch is stale —
something `gt log` does not print. It can only do that by _not_ running `gt`: every
`gt` command, including `gt log`, silently refreshes the recorded head first.

**Drives the small set of operations stacked work needs.** `restack`, `submit`,
`sync`, and `merge`, invoked non-interactively on the machine that owns the workspace,
with a working-tree check before anything destructive. `sync` refuses linked
worktrees.

**Answers to agents and people the same way.** One snapshot, rendered as text for a
terminal and as `--json` for an agent.

Every write verb refuses a working tree that could lose work —
`dirty_uncommitted`, `committed_unmerged`, `dirty_and_committed_unmerged`, or a
state it does not recognise — unless you pass `--force`. `clean` and `untracked`
proceed.

`merge` was exercised against an eight-PR stack in the standalone repository on
2026-09-21. Graphite merged each PR in order after restacking and rechecking the
next branch.

`submit` is verified against a real remote: it pushed a two-branch stack to the
former standalone repository and opened both PRs correctly based on each other. Note that `gt` creates
new PRs as drafts when run non-interactively without `--publish`. Check existing
PRs before reporting their readiness. See [`.agents/plans/20260918-init/`](.agents/plans/20260918-init/).

## What it couples to

This plugin reads `.graphite_metadata.db`, a private file Graphite writes inside your
git directory. Graphite does not document it, version it, or offer an alternative:
there is no `--json`, no export, and no machine-readable interop surface in the CLI as
of `1.8.6`.

Reading it is a deliberate trade. It is the only way to see a branch whose recorded
head has fallen behind the repository, and it is the only structured source there is.
The cost is that a Graphite release could change the schema.

Two things bound that risk. The plugin opens the database **read-only** and never
writes to it. And it checks Graphite's own migration list on every read, warning about
any migration it does not recognize. All Graphite repositories
observed so far report the same three migrations, whose ids are dated within nine days
of each other in early 2026; each database applies them when the CLI first opens it.

If you are not comfortable with that coupling, do not install this plugin.

## Not in scope

- Resolving conflicts. A conflict goes back to a person or a builder agent.
- Automatic merge policy. Merging is operator-invoked.
- Jujutsu and GitButler. Different models; generalizing early would be a guess.
- Replacing `gt`. This drives it.

## License

MIT
