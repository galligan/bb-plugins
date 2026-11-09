# Worktrees+ (`bb-plugin-wt`)

An environment provider for [bb](https://github.com/get-bb/bb) that runs a thread in a Git worktree it creates under `~/.worktrees`, and sets that worktree up from scripts the repository already has.

It appears in the New Thread environment picker as **Worktrees+**, beside bb's built-in **Worktree**.

## What it does

When a thread starts on this provider, the plugin:

1. Creates a worktree at `~/.worktrees/<host>/<owner>/<repo>/<branch>` on a new branch. The branch name is the one bb suggests (it honours bb's `managedBranchPrefix` setting) and has no upstream until you push it.
2. Copies the source checkout's untracked files that match the repo's `.worktreeinclude` (gitignore syntax). Regular files only; nothing already in the worktree is replaced.
3. Sets the worktree up from the first of these the repo has:
   - `.bb-env-setup.sh` / `.bb-env-teardown.sh`: bb core runs these itself, so the plugin runs nothing extra.
   - `.codex/environments/environment.toml`: the plugin runs its `[setup] script` after creating the worktree and its `[cleanup] script` before removing it, with `CODEX_WORKTREE_PATH` set to the worktree.
   - Neither: the worktree is left as a bare checkout.

A failing setup script fails the launch, and its output is shown in the thread's workspace-setup block.

## Where worktrees go

The folder is derived from the checkout's `origin` remote, never from the bb project name, so renaming a project or moving a checkout does not relocate its worktrees.

| Remote                                  | Folder under `~/.worktrees`         |
| --------------------------------------- | ----------------------------------- |
| `github.com/<owner>/<repo>`             | `gh/<owner>/<repo>/<branch>`        |
| `gitlab.com/<group>/<repo>`             | `gl/<group>/<repo>/<branch>`        |
| `*.entire.io/et/<owner>/<repo>`         | `et/<owner>/<repo>/<branch>`        |
| `origin.cursor.com/<owner>/<repo>`      | `cursor/<owner>/<repo>/<branch>`    |
| `gitea.com`, `codeberg.org`             | `gitea/...`, `codeberg/...`         |
| Any other host (self-hosted Gitea etc.) | `<hostname>/<path>/<branch>`        |
| No `origin` remote                      | `_local/<checkout folder>/<branch>` |

Slashes in the branch name become dashes, so `feat/x` and `feat/x/y` never nest. A worktree's path is recorded when it is created and does not move if the remote later changes.

## Base branch

By default the new branch starts from the remote's default branch, using the local branch of that name when it exists, and that branch is recorded as the environment's merge base for diffs. Pass a different base from the CLI:

```sh
bb thread spawn --environment-provider wt --environment-inputs '{"base":"my-parent-branch"}' --prompt '...'
```

## Retention and removal

Worktrees are kept until their environment is deleted. Unlike the built-in provider, archiving the last thread does not start a removal timer.

Removal keeps the branch, and before deleting the folder it saves any uncommitted or untracked files as a commit under `refs/wt-rescue/<branch>-<timestamp>` in the repository. Restore them with `git checkout <ref> -- .`. If that save fails, the worktree is left in place. Files git ignores (such as an edited `.env`) are not saved; removal names them in its log. The plugin refuses to delete any path outside `~/.worktrees`.

## Is a worktree safe to remove?

```sh
bb wt list          # add --json for machine-readable output
```

Each worktree is marked `SAFE` or `UNSAVED`, with the reasons:

- tracked files with uncommitted changes, and untracked files;
- ignored files listed in `.worktreeinclude` that were edited in the worktree, which `git status` never shows;
- an unfinished rebase, merge, cherry-pick, revert or bisect;
- a detached HEAD on commits no branch or remote reaches.

It also reports where the branch's commits stand: `no commits yet`, `merged into base`, `pushed`, or `local only` with a count. `merged into base` compares content, not commit ids, so it still holds after a squash merge or a rebase. These do not affect `SAFE`, because removal keeps the branch. The check runs no fetch, so `pushed` and `merged` reflect the remote as last fetched. `last activity` is the newest uncommitted file's modification time or, in a clean worktree, the last commit.

## Not yet built

- A picker control for choosing the base branch in the UI.
- Stack-aware bases for Graphite and gh-stack.
- Agent tools for spawning sibling and child threads.
- Adopting or taking over worktrees created by Claude Code or Codex.
- Linking (rather than copying) shared directories such as `node_modules`.

## Development

```sh
bun install          # once, at the repository root
bun run test         # unit and git-fixture tests (node --test)
bun run check        # tsc
bun run build        # bb plugin build
bb plugin install .  # install this checkout into the running bb
```
