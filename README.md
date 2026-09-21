# bb-plugins

Independent plugins for [bb](https://github.com/get-bb/bb).

Each directory under [`plugins/`](plugins/) is its own versioned, buildable bb
plugin. The [collection manifest](.bb/plugins.json) lets bb install one plugin
from this repository without a separate distribution branch.

## Plugins

| Plugin                                   | Description                                                        |
| ---------------------------------------- | ------------------------------------------------------------------ |
| [`bb-plugin-linear`](plugins/linear)     | Search and attach fresh Linear issue context from bb's prompt box. |
| [`bb-plugin-graphite`](plugins/graphite) | Read and drive Graphite stacks from bb.                            |

## Install

Install one plugin from the repository's `main` branch:

```sh
bb plugin install git:https://github.com/galligan/bb-plugins.git@main --plugin graphite
```

The collection currently advertises only Graphite. The `linear` distribution
branch remains available for existing installs while Linear's package and
verification are brought up to the repository standard.

Check and apply compatible updates with:

```sh
bb plugin outdated
bb plugin update graphite
```

The `main` ref tracks new commits. Use a commit SHA to pin an installation.
bb records the selected package directory so updates remain plugin-specific.

## Develop

Install the pinned Bun toolchain dependencies at the repository root, then run
the repository checks:

```sh
bun install
bun run format:check
bun run lint
bun run check
bun run test
bun run build
```

These root checks cover Graphite and future plugins. Linear is temporarily
excluded from formatting, linting, type checks, tests, and builds until its
existing package is brought up to the same standard.

For source development, clone this repository and install a package from its
directory:

```sh
bb plugin install ./plugins/graphite
bb plugin dev ./plugins/graphite
```

Plugins run as full-trust code inside the bb server. Review a plugin before
installing it and keep credentials in its declared secret settings.

## Related repositories

- [get-bb/bb](https://github.com/get-bb/bb) — the application and public plugin SDK
- [galligan/bb-plugin-studio](https://github.com/galligan/bb-plugin-studio) — browser workbench and plugin inspection tooling

## License

MIT
