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

## Distribution

The root `.bb/plugins.json` indexes verified packages under `plugins/`.
Graphite is the first entry. Install a listed package from the repository's `main` branch with
`bb plugin install git:<repo>@main --plugin <name>`. The
`publish-plugin-branches` workflow continues to update only the
legacy `linear` branch for existing installs. Do not edit that generated branch
by hand.

Root verification currently excludes Linear; add it back once its package
passes the same format, lint, check, test, and build gates.
