# Worktree+ (`bb-plugin-wt`)

An environment provider for [bb](https://github.com/get-bb/bb) that runs a thread in a Git worktree it creates under `~/.worktrees`, and sets that worktree up from scripts the repository already has.

It appears in the New Thread environment picker as **Worktree+**, beside bb's built-in **Worktree**.

## What it does

When a thread starts on this provider, the plugin:

1. Creates a worktree at `~/.worktrees/<host>/<owner>/<repo>/<branch>` on a new branch. The branch has no upstream until you push it. See [Branch names](#branch-names).
2. Copies the source checkout's untracked files that match the repo's `.worktreeinclude` (gitignore syntax). Regular files only; nothing already in the worktree is replaced.
3. Sets the worktree up from the first of these the repo has:
   - `.bb-env-setup.sh` / `.bb-env-teardown.sh`: bb core runs these itself, so the plugin runs nothing extra.
   - `.codex/environments/environment.toml`: the plugin runs its `[setup] script` after creating the worktree and its `[cleanup] script` before removing it, with `CODEX_WORKTREE_PATH` set to the worktree.
   - Neither: the worktree is left as a bare checkout.

A failing setup script fails the launch, and its output is shown in the thread's workspace-setup block. Scripts get 15 minutes, their output is capped, and a script is never run twice for the same launch: if bb restarts mid-script, the launch fails and asks for a retry instead of replaying it.

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

## Branch names

A new branch is named `<prefix><slug>-thr_<thread id>`. bb supplies the slug and thread id, which ties the branch to its thread and keeps two launches from colliding.

The prefix comes from the first of these that is set:

1. This plugin's **Branch prefix** setting.
2. bb's own branch prefix (Settings → General).
3. `bb/`.

So a worktree branch always has a prefix, even when bb is configured with none. Turn off **Prefix worktree branches** to use bb's suggested name unchanged. Both settings are under Settings → Installed plugins → Worktree+, or `bb plugin config wt set <key> <value>` with keys `branchPrefix` and `prefixBranches`.

## Base branch

Pick the base in the New Thread composer with the **Branch from:** control beside the provider, the same control the built-in Worktree offers. It starts on the project's default base, normally `origin/main`. The chosen base is recorded as the environment's merge base for diffs.

From the CLI, omit the inputs to start from the remote's default branch as last fetched, or pass a base:

```sh
bb thread spawn --environment-provider wt --environment-inputs '{"base":"my-parent-branch"}' --prompt '...'
```

## Retention and removal

A worktree is kept for as long as a thread uses it. Once every thread on it is archived or deleted, bb removes it after a grace period (30 minutes by default); unarchiving a thread within that time keeps it. Deleting the environment removes it straight away.

Two settings control this: **Remove worktrees after their threads are archived** (`retireWhenArchived`, on by default) and **Grace period before removal (minutes)** (`retireGraceMinutes`). Turn the first off to keep worktrees until their environment is deleted. Changing either reloads the plugin so it applies at once.

A removal that is refused (see below) leaves the worktree in place, and bb shows the environment's cleanup as failed with the reason.

Removal keeps the branch and fails closed: nothing is deleted unless every uncommitted change was saved first.

- Cleanup scripts and running processes are finished before anything is saved, so their last writes are included.
- Uncommitted and untracked files are saved as a commit under `refs/wt-rescue/<branch>-<timestamp>-<id>` in the repository. Restore them with `git checkout <ref> -- .`. Anything that was staged is kept as that commit's second parent (`<ref>^2`), the way `git stash` does.
- Only `git worktree remove` deletes the folder. If the worktree cannot be inspected, the save fails, or git refuses, the worktree is left in place and the removal reports why.
- A submodule with uncommitted changes or unpushed commits blocks removal, because its repository lives inside the worktree and cannot be saved automatically. Commit and push there, then delete again.
- Unresolved merge conflicts block removal too: a conflicted index cannot be saved faithfully. Resolve or abort the merge, then delete again.
- So does a git operation in progress, such as a paused rebase or cherry-pick: its remaining steps cannot be saved. Finish or abort it, then delete again.
- If the folder is no longer the worktree the plugin created (it was removed by hand and something else now sits at that path), the plugin leaves it alone and says so.
- Ignored files are never saved to git, because that is where secrets live and a rescue commit can be pushed. If a file copied in through `.worktreeinclude` (such as `.env`) was edited in the worktree, that edit exists nowhere else, so it blocks removal. Copy what you need back to the main checkout or discard the edit, then delete again. Other ignored files, such as build output, are deleted with the worktree.
- The plugin refuses to delete any path outside `~/.worktrees`, including through a symlinked folder.

If a branch with the suggested name already exists, the new worktree checks it out as it is. The plugin never resets a branch.

## Is a worktree safe to remove?

```sh
bb wt list          # add --json for machine-readable output
```

Each worktree is marked `SAFE` or `UNSAVED`, with the reasons:

- tracked files with uncommitted changes, and untracked files;
- ignored files listed in `.worktreeinclude` that were edited in the worktree, which `git status` never shows;
- an unfinished rebase, merge, cherry-pick, revert or bisect;
- files with unresolved merge conflicts;
- a detached HEAD on commits no branch or remote reaches;
- a submodule with uncommitted changes or unpushed commits.

It also reports where the branch's commits stand: `no commits yet`, `merged into base`, `pushed` (every commit is on a remote), or `local only` with a count. `merged into base` compares content, not commit ids, so it still holds after a squash merge or a rebase. These do not affect `SAFE`, because removal keeps the branch. The check runs no fetch, so `pushed` and `merged` reflect the remote as last fetched. `last activity` is the newest uncommitted file's modification time or, in a clean worktree, the last commit.

## Worktrees panel

Open **Worktrees** in bb's navigation (`/plugins/wt/worktrees`) to see Worktree+ records on connected machines, grouped by project and machine. Rows show safety reasons, commit state, last activity and links to owning threads, including archived ones. Records without a recognizable project appear under **Unknown project**. A machine that cannot be read has its own error; use **Refresh** to try again. The visible page refreshes every 30 seconds and after provider changes.

**Remove** asks for confirmation and explains which work can be rescued and which conditions block removal. A fresh inspection after cleanup decides whether removal can proceed. Environments are removed through bb core, which may refuse while threads are live or stopping; **Retry removal** asks core to retry failed teardown. Orphan records use the same fail-closed host removal path. There is no force action.

**Rescued work** lists rescue refs in each project's source repositories. Copy the restore command and run it in that repository to recover files. Refs have no delete or restore action in the panel. Inspection does not fetch, so commit status reflects the last fetched refs. Missing records and damaged records need attention; a missing record is never proof of filesystem ownership.

## Not yet built

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
