See and operate on Graphite stacks from BB.

## What you get

- A compact composer banner showing the current branch's position, restack state,
  offshoots, and the BB threads working on each branch.
- `bb graphite stack` for a readable snapshot, or `--json` for structured output.
- `bb graphite restack`, `submit`, `sync`, and `merge` for explicit, non-interactive
  Graphite operations. Write commands check the workspace state first.
- A read-only `graphite_stack` agent tool and a bundled skill.

## Requirements and tradeoff

Install the Graphite CLI on the machine that owns the workspace and initialize
Graphite in the repository. Reading a stack needs no Graphite account; submitting
and merging PRs require the appropriate remote access.

The plugin reads Graphite's private metadata database without changing it. It
warns when the database reports an unfamiliar migration, since a future Graphite
release could change the schema.
