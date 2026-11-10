# Lifecycle and data preservation

These lessons come from Worktree+'s implementation and regression tests. They apply when a plugin owns filesystem resources or launches processes; ordinary read-only UI work does not need a worktree-removal protocol. The [Worktree+ invariants](../../plugins/wt/AGENTS.md) remain authoritative for that package.

## Core owns environment lifecycle

The current environment-provider contract gives bb core responsibility for launch attempts, cancellation, retries, attachment, retirement, and removal. Providers implement resource operations rather than a second lifecycle scheduler. Worktree+ configures `policy.retireGraceMs` in [`server.ts`](../../plugins/wt/server.ts); [`lib/retire.ts`](../../plugins/wt/lib/retire.ts) translates its settings to that policy. A registration-time policy change is applied by reloading the plugin.

Core runs `.bb-env-setup.sh` after a provider returns an owned path and `.bb-env-teardown.sh` before removal. A provider must not run those hooks again. Worktree+'s [`lib/setup-plan.ts`](../../plugins/wt/lib/setup-plan.ts) distinguishes BB-owned hooks from its Codex setup fallback. Repository-level reference cloning uses the BB setup hook because `.worktreeinclude` cannot copy nested Git repositories; it is separate from the provider's own lifecycle logic.

## A claim is not ownership

`experimental_claimPath` reserves a host/path for a launch. It does not prove the directory belongs to the provider or make pre-existing content disposable. Worktree+ records intent before mutation, transitions from `planned` to `owned` only after creation or verification, and checks a `wt-launch` marker before removal. It checks real filesystem containment as well as recorded identity; branch names and lexical path prefixes are insufficient.

Creation must be repeatable for the same `pathKey`. Cancellation can lead to removal before creation has returned a path, so cleanup must recover from the path key and persisted record. Keep enough local resource state for recovery without duplicating core's launch scheduler. An interrupted setup recorded as running has an unknown outcome and must not be silently replayed.

## Preserve data before removing a resource

Worktree+ finishes cleanup scripts and terminates processes before inspection and rescue. Otherwise a process could write after its files were inspected or saved. A shell leader exiting does not prove its process group is gone; [`lib/process.test.ts`](../../plugins/wt/lib/process.test.ts) covers surviving children and termination behavior.

The removal path in [`lib/worktree.ts`](../../plugins/wt/lib/worktree.ts) refuses states that cannot be saved faithfully: unresolved conflicts, an in-progress Git operation, unsaved submodule work, and edited ignored files copied through `.worktreeinclude`. Inspection or snapshot errors preserve the directory. A failed `git worktree remove` does not authorize a fallback recursive deletion.

Rescue snapshots save tracked and ordinary untracked work without changing the user's branch, index, or working tree. The index can hold a different staged version from the file on disk; saving only the working tree would lose it. Worktree+ records that staged state in a separate parent. Ignored files are excluded because a Git object can be pushed, even when intended only as a local rescue. Edited ignored shared files block removal instead of being committed. See [`saveRescueSnapshot`](../../plugins/wt/lib/inspect.ts) and [`lib/removal-safety.test.ts`](../../plugins/wt/lib/removal-safety.test.ts).

Submodules need inspection beyond the current `.gitmodules` file: module repositories can survive removal of their index entries. Likewise, saving raw index bytes does not preserve the Git objects those bytes reference. Tests should demonstrate that content remains recoverable, not merely that a marker file or byte buffer exists.

## Keep inspection read-only

Listing safety or checking whether removal is possible must not fetch objects, rewrite indexes, or refresh the metadata whose age is being measured. Worktree+'s [`lib/inspect.test.ts`](../../plugins/wt/lib/inspect.test.ts) checks these boundaries. Use temporary repositories with real Git state for destructive-path tests, including staged-only versions, submodule changes, failed creation, reused paths, and cleanup failures.
