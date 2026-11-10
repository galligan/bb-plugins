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
| [`bb-plugin-wt`](plugins/wt)             | Run threads in Git worktrees set up from the repo's own scripts.   |

## Install

Install one plugin from the repository's `main` branch:

```sh
bb plugin install git:https://github.com/galligan/bb-plugins.git@main --plugin graphite
```

The collection advertises Graphite and Worktree+ (`wt`). The `linear` distribution
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

## Reference plugins

[`repos.json`](repos.json) lists third-party plugins available for local research. Run `bun run repos clone` to clone missing repositories into ignored `repos/<owner>--<repo>/` directories. Run `bun run repos pull` to clone missing repositories and fast-forward existing clean checkouts. Edit the manifest to change the reference set; removing an entry leaves its local checkout untouched. These commands only download source and do not install plugins or run their code.

New BB worktrees run [`.bb-env-setup.sh`](.bb-env-setup.sh), which populates the references from existing local worktrees when possible and falls back to GitHub. Each clone has independent Git storage and retains its GitHub origin, so removing the source worktree does not break it. Local uncommitted edits are not copied. This uses the setup hook because `.worktreeinclude` copies regular files and cannot copy nested Git repositories. The hook and manifest must be committed on the branch used to create new worktrees; Bun and Git must be available. A clone failure fails setup with an error; rerunning `bun run repos clone` preserves existing checkouts.

The clones stay outside the Bun workspace and are excluded from Git and formatting. Only the manifest, script, hook, and documentation belong in this repository's history.

## Related repositories

- [get-bb/bb](https://github.com/get-bb/bb) — the application and public plugin SDK
- [galligan/bb-plugin-studio](https://github.com/galligan/bb-plugin-studio) — browser workbench and plugin inspection tooling

## License

MIT
