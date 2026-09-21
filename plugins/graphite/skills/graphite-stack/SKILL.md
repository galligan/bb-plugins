---
name: graphite-stack
description: Read and drive the Graphite stack for a project with `bb graphite`. Use when the user asks where a branch sits in its stack, what needs a restack, or asks to restack, submit, sync, or merge stacked branches.
---

# Graphite stacks

`bb graphite` reads the stack from Graphite's own metadata and joins it with BB's
view of the workspace. It never runs `gt log` or `gt ls` to do it.

## Read the stack

```sh
bb graphite stack          # the chain around the checked-out branch
bb graphite stack --json   # the same snapshot, structured
```

- Run it inside a project or a thread; it acts on that thread's environment.
- MUST NOT run `gt log` or `gt ls` instead. Every `gt` command refreshes
  Graphite's recorded head as a side effect, which destroys the staleness this
  command reports.
- `needsRestack` on a branch means a branch at or below it sits on a parent that
  has moved. Restacking it moves everything above it.
- `isStale` means Graphite's recorded head disagrees with the branch's real head.

## Drive the stack

```sh
bb graphite restack        # rebase the stack onto its parents
bb graphite submit         # push the stack; new PRs default to drafts
bb graphite sync           # pull trunk, restack, drop merged branches
bb graphite merge          # merge the stack in order
```

`submit` takes `--publish`, `--merge-when-ready`, and `--update-only`.

- `submit` opens new PRs as **drafts**. That is `gt`'s behaviour when it cannot
  prompt, and this command never prompts.
- `--publish` opens them for review. MUST NOT pass it unless the user asked for the
  PRs to be published. Report that the PRs are drafts and let them decide.
- `--merge-when-ready` lets each PR merge itself once its checks pass. MUST NOT pass
  it unless the user asked for that specific behaviour.

- Every write verb refuses a working tree that could lose work. `clean` and
  `untracked` proceed; dirty or unknown states are refused.
- If a verb refuses, report the reason. MUST NOT pass `--force` to get past it
  unless the user asked for that specific verb to proceed on a dirty tree.
- Each verb runs `gt` non-interactively. It cannot prompt, so it cannot hang.
