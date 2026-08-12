# bb-plugins

Independent plugins for [bb](https://github.com/get-bb/bb).

Each directory under [`plugins/`](plugins/) is its own versioned,
buildable, and publishable bb plugin. The repository begins with the Linear
plugin, relocated from
[bb Plugin Studio](https://github.com/galligan/bb-plugin-studio) with its
source history intact.

## Plugins

| Plugin                               | Description                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| [`bb-plugin-linear`](plugins/linear) | Search and attach fresh Linear issue context from bb's prompt box. |

## Install

Install a plugin directly from its distribution branch—no repository clone is
needed:

```sh
bb plugin install git:https://github.com/galligan/bb-plugins.git@linear
```

The `linear` branch tracks `plugins/linear` from this repository's `main`
branch. Check and apply compatible updates with:

```sh
bb plugin outdated
bb plugin update linear
```

Git tags and commit SHAs are pinned instead of tracking updates. Replace
`linear` in the install command with a tag or commit from that distribution
branch when you need a fixed revision.

bb currently installs a Git plugin from the checked-out repository root; a
GitHub URL such as `.../tree/main/plugins/linear` cannot select a monorepo
subdirectory. The per-plugin branches put the corresponding plugin manifest at
their root and are regenerated from `main` after changes land.

## Develop

Install the pinned Bun toolchain dependencies at the repository root, then run
the repository checks:

```sh
bun install
bun run format:check
bun run check
bun run test
bun run build
```

For source development, clone this repository and install the plugin from its
package directory:

```sh
bb plugin install ./plugins/linear
bb plugin dev ./plugins/linear
```

Plugins run as full-trust code inside the bb server. Review a plugin before
installing it and keep credentials in its declared secret settings.

## Related repositories

- [get-bb/bb](https://github.com/get-bb/bb) — the application and public plugin SDK
- [galligan/bb-plugin-studio](https://github.com/galligan/bb-plugin-studio) — browser workbench and plugin inspection tooling

## License

MIT
