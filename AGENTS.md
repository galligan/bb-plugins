# AGENTS.md

This repository contains independently versioned plugins for
[bb](https://github.com/get-bb/bb).

## Repository boundaries

- `plugins/<name>` is a real bb plugin package with its own manifest, version,
  tests, and release lifecycle.
- The sibling `../plugin-studio` checkout is optional authoring and inspection
  tooling. Plugins must not depend on its private workspace packages.
- The sibling `../bb` checkout is the canonical bb application source. Treat it
  as read-only unless the task explicitly includes bb itself.
- Use the public `@bb/plugin-sdk` surface. Do not import bb internals.

## Development

- Use Bun; the pinned version is in the root `package.json`.
- Run `bun install` once at the repository root.
- Run `bun run format:check`, `bun run check`, `bun run test`, and
  `bun run build` before pushing.
- Keep plugin package names in the form `bb-plugin-<name>`.
- Preserve plugin ids and settings keys when moving or refactoring a plugin;
  changing them can strand installed settings.
- Plugins are full-trust server code. Keep permissions and network access
  narrow, never log secrets, and bound external calls and prompt context.

## Structure

- Keep plugins independent, even when that means a small amount of duplication.
- Introduce shared code only after at least two plugins have the same proven
  need, and keep the plugin package itself independently buildable.
- Put plugin-specific documentation beside the plugin. Keep repository-wide
  contribution and release guidance at the root.

## Changes

- Prefer small, reviewable changes on a non-main branch.
- Add tests for behavior changes and update the relevant plugin README.
- Do not hand-edit generated `dist/` output or generated SDK declarations.
