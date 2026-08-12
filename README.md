# bb-plugins

Independent plugins for [bb](https://github.com/get-bb/bb).

Each directory under [`plugins/`](plugins/) is its own versioned,
buildable, and publishable bb plugin. The repository begins with the Linear
plugin, relocated from
[bb Plugin Studio](https://github.com/galligan/bb-plugin-studio) with its
source history intact.

## Plugins

| Plugin | Description |
| --- | --- |
| [`bb-plugin-linear`](plugins/linear) | Search and attach fresh Linear issue context from bb's prompt box. |

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

To work on a plugin through bb, install it from its package directory:

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
