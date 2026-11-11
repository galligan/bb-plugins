# AGENTS.md

This repository contains independently versioned plugins for [bb](https://github.com/get-bb/bb). Read the affected plugin's `AGENTS.md` before editing its code. Use [docs/dev/](docs/dev/README.md) for development patterns and the evidence behind them.

## Repository boundaries

- `plugins/<name>` is a real bb plugin package with its own manifest, version, tests, and release lifecycle. Keep package names in the form `bb-plugin-<name>`.
- The bb application source and optional plugin-studio checkout are separate repositories. Locate them rather than assuming `../bb` or `../plugin-studio` exists beside a linked worktree. Treat them as read-only unless the task explicitly includes those repositories.
- Use the public `@get-bb/plugin-sdk` surface. Do not import bb internals.
- Keep plugins independently buildable. Do not depend on plugin-studio private packages, sibling plugin source, or ignored research clones.
- Preserve plugin ids and settings keys when moving or refactoring a plugin; changing them can strand installed settings.

## Development

- Use Bun; the pinned version is in the root `package.json`.
- Run `bun install` once at the repository root.
- Run `bun run preflight` before plugin work. It reports the installed BB, the SDK that BB bundles, and the repository's SDK, Bun and TypeScript pins. If BB is behind the latest stable release or is a development or nightly build, stop and tell the user. If only a pin is behind npm latest, report it and continue: bump the SDK when the task needs the newer one, and move Bun or TypeScript as a change of its own. See [BB and SDK versions](docs/dev/verification.md#bb-and-sdk-versions).
- Run `bun run format:check`, `bun run lint`, `bun run check`, `bun run test`, and `bun run build` before pushing. See [verification](docs/dev/verification.md) for package checks and CI parity.
- Verify plugin behavior in tests before starting BB. Load the real `server.ts`, `host.ts`, and `app.tsx` through the public `@get-bb/plugin-sdk/testing` harnesses. Use a live BB only for what the harness cannot reproduce, on an isolated instance reached through `bun run bb-target` and never the user's active one. See [choose the test boundary](docs/dev/verification.md#choose-the-test-boundary).
- Before adding or migrating an SDK call, inspect the affected package's SDK pin and the current public contract. Use the available `bb-plugin-authoring` skill for the relevant surface. Do not copy deprecated calls from an older plugin as the pattern for new work.
- Run checkout-specific filesystem and process operations on the environment's host, not the bb server. See [plugin patterns](docs/dev/plugin-patterns.md).
- Plugins are full-trust code. Keep permissions and network access narrow, never log secrets, and bound external calls and prompt context.
- Do not hand-edit generated `dist/` output or generated SDK declarations. Regenerate through the owning package's tools and review any SDK pin changes.

## Structure

- Keep plugins independent, even when that means a small amount of duplication. Introduce shared code only after at least two plugins have the same proven need, while preserving independent package builds.
- Keep registration and UI adapters thin; put reusable behavior in the plugin's own `lib/` modules.
- Before adding or changing UI, read [Plugin UI and UX](docs/dev/ui-ux.md). Reuse BB's host surfaces, public capability components, and registry controls before introducing custom UI; preserve host navigation, theme, focus, and compact-layout behavior.
- Put plugin-specific instructions and operating documentation beside the plugin. Put cross-plugin development lessons in `docs/dev/`, with links to code or tests that establish the behavior. Keep contribution and release policy in [CONTRIBUTING.md](CONTRIBUTING.md).

## Research and worktrees

- Manage third-party examples with `repos.json` and `bun run repos clone` / `bun run repos pull`. `repos/` is ignored reference material, not a workspace package or authoritative SDK contract. Do not stage the clones or install them merely to inspect their source.
- `.bb-env-setup.sh` populates reference clones in new BB worktrees. Do not replace it with a `repos/` entry in `.worktreeinclude`: BB's file copier does not copy nested Git checkouts. See [reference plugins](README.md#reference-plugins).
- When changing an environment provider, preserve bb core's ownership of retries, retirement, and `.bb-env-setup.sh` / `.bb-env-teardown.sh`. Follow the affected plugin's invariants and [lifecycle and data preservation](docs/dev/lifecycle.md).

## Changes

- Prefer small, reviewable changes on a non-main branch.
- Add tests for behavior changes and update the relevant plugin README.
- Keep PRs draft until CI passes. Address review findings with scoped fixes and reply to resolved threads.
- `autolabel` derives `plugin/<directory>` labels from changed paths. New plugins need no label mapping; see [plugin labels](CONTRIBUTING.md#plugin-labels).
