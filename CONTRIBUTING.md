# Contributing

Create a focused branch and keep each change scoped to one plugin when
possible. Every plugin owns its manifest, tests, documentation, compatibility
ranges, and release version.

Before opening a pull request, run:

```sh
bun run format:check
bun run check
bun run test
bun run build
```

Pull requests should explain the user-visible behavior, compatibility impact,
and how the change was verified. Never include plugin credentials or generated
build output.

## Distribution branches

Direct bb Git installs require the plugin manifest at the repository root.
After a change reaches `main`, the `publish-plugin-branches` workflow splits
each `plugins/<name>` directory onto a matching `<name>` branch. Do not edit
those generated branches by hand.
