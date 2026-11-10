# Contributing

Create a focused branch and keep each change scoped to one plugin when
possible. Every plugin owns its manifest, tests, documentation, compatibility
ranges, and release version.

Before opening a pull request, run:

```sh
bun run format:check
bun run lint
bun run check
bun run test
bun run build
```

Pull requests should explain the user-visible behavior, compatibility impact,
and how the change was verified. Never include plugin credentials or generated
build output.

## Plugin labels

The repository-owned `autolabel` workflow adds `plugin/<directory>` labels to PRs that change files under `plugins/<directory>/`. It handles multiple plugins, deleted files, and both sides of a rename. Labels are additive: existing labels are never removed, even if later commits change the PR's scope.

Missing labels are created automatically with a default blue color. Existing label colors and descriptions are preserved. Pushes to `main` and manual workflow runs also create labels for all current plugin directories, so new plugins need no label configuration. Issues can use these same labels manually; they have no changed-file list to infer a plugin from.

Fork PRs are supported through `pull_request_target`. The workflow checks out only the trusted base revision and reads PR file paths through the GitHub API; it never checks out or executes PR head code. It needs read access to contents, write access to issues for label creation, and write access to PRs for label assignment; GitHub rejects adding labels to a PR with only issues write. Automatic PR labeling becomes active once the workflow is on the base branch.

## Distribution

The root `.bb/plugins.json` indexes verified packages under `plugins/`.
Graphite is the first entry. Install a listed package from the repository's `main` branch with
`bb plugin install git:<repo>@main --plugin <name>`. The
`publish-plugin-branches` workflow continues to update only the
legacy `linear` branch for existing installs. Do not edit that generated branch
by hand.

Root verification currently excludes Linear; add it back once its package
passes the same format, lint, check, test, and build gates.
