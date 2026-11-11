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

Plus a `graphite_stack` agent tool and a compact control in the thread header. The header shows the current branch's stack position and status; click to open a side-panel tab with lineage, restack warnings, and threads on each branch. In narrow windows BB moves the action into the thread menu. It appears only when the selected spine has multiple branches. A 1/1 spine with offshoots keeps the header action hidden; its lineage remains available by opening Graphite stack from BB's new-tab launcher.

The UI needs BB 0.49.0 and public SDK 0.6.132 or newer, using the host header action and side-panel tab APIs. BB 0.49.0 renders that action as a text button without a custom icon or tooltip, so status is included in its label. The Git plugin (`bb--git`) supplies validated workspace status. Stack reads poll every 15 seconds because Graphite changes its database without a BB event; hidden documents and inactive stack panels do not poll. Temporary read failures retain the last stack and show a refresh failure; a failed refresh after an empty result shows a load error instead of presenting the cached absence as current; JSON reads distinguish `unavailable` from a successful `none` result.

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

## Tests

Run `bun run test` in this package (Node 24), or the repository's root test gate. Nothing here invokes `gt`, connects to a daemon, starts BB, or needs credentials. Bun `1.3.14` orchestrates the run; Node executes the `node --test` suites because Bun cannot import `node:sqlite`.

| Suite                                              | Runner            | Covers                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`lib/server.test.ts`](lib/server.test.ts)         | `node --test`     | The real server factory under `@get-bb/plugin-sdk/testing`: CLI/RPC/tool registration, invalid CLI and RPC inputs before host work, environment-host routing, malformed host and RPC outputs, the unsafe-write guard, CLI cancellation forwarding, and replacement/stale registrations after reload and disposal                                                         |
| [`lib/host-entry.test.ts`](lib/host-entry.test.ts) | `node --test`     | The real `host.ts` under `@get-bb/plugin-sdk/testing/host`: stack requests and results against a temporary repository and SQLite metadata, noninteractive CLI arguments, and request cancellation and harness disposal terminating a disposable CLI process                                                                                                              |
| [`tests/stack.test.tsx`](tests/stack.test.tsx)     | Vitest with jsdom | The real `app.tsx` under `@get-bb/plugin-sdk/testing/app`: tab, header action, and icon registration; loading, stacked, none, single-branch, failed, and unavailable states; offshoot disclosure; thread links; no reads while the tab is closed or unselected; the header action's label and the tab it opens; cached refresh failures, recovery, and confirmed absence |
| [`lib/imports.test.ts`](lib/imports.test.ts)       | `node --test`     | The public-SDK import scan, allowing only package-local files and declared dependencies                                                                                                                                                                                                                                                                                  |
| Other `lib/**/*.test.ts`                           | `node --test`     | Stack reading, chain building, verbs, and submit arguments as plain functions                                                                                                                                                                                                                                                                                            |

SDK calls and host responses are offline fixtures. The plugin declares no settings, background services, watches, or custom disposal hook, so no synthetic settings or resource behavior is added to its tests. In the host-entry test a new harness remains usable after disposal and stale harness calls fail; the fixture substitutes the CLI discovery home before loading the entry, without changing `HOME`/`PATH` or invoking an installed `gt`.

Lineage drawing, lane widths, and the header action's compact placement are layout, which jsdom does not reproduce. Those are the only parts that need a live BB; see [choose the test boundary](../../docs/dev/verification.md#choose-the-test-boundary).

`host.ts` imports `experimental_defineHostEntry` from the public SDK root. An earlier SDK failed on a direct `@get-bb/plugin-sdk/host` import under Node 24 with `Dynamic require of "child_process" is not supported`; that no longer reproduces with SDK `0.6.138` on Node `24.22.2` (`node --input-type=module -e 'await import("@get-bb/plugin-sdk/host")'` succeeds). The root import stays because it keeps the SDK a `devDependencies` entry: importing the `/host` subpath makes the build bundle it from the plugin's own install, which requires the SDK in `dependencies`.

This coverage establishes in-process registration, contract behavior, and cancellation of a fixture subprocess. Server cancellation checks delivery to its fake host driver. It does not establish real Graphite CLI behavior, daemon worker startup/reconnect, or production host loading. No frontend layout, loading/empty/error UI, live install/reload, or daemon integration claim follows from these tests or a successful build.
