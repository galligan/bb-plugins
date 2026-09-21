# Testing setup

Test against a separate BB instance. Do not install a plugin under development into
the live instance.

Verified 2026-09-18 against BB `0.43.1`.

## One command

```sh
scripts/bb-test-instance.sh start      # launch, wait for ready, print the exports
scripts/bb-test-instance.sh install    # build this plugin and install it there
scripts/bb-test-instance.sh run <...>  # run one bb command against it
scripts/bb-test-instance.sh status
scripts/bb-test-instance.sh stop
```

- `start` is idempotent and refuses a port already in use.
- `run` needs no exported variables, so it works the same in fish.
- To bind a bash or zsh shell instead: `eval "$(scripts/bb-test-instance.sh env)"`.
- Override with `BB_TEST_DATA_DIR`, `BB_TEST_SERVER_PORT`, `BB_TEST_DAEMON_PORT`.

The rest of this file records what the script does and why, for when it breaks.

## Launch an isolated instance

The installed desktop app ships a headless entrypoint. Use it — it is the same
`0.43.1` build the live instance runs, so no npm install and no `../bb` build is
needed.

```sh
BB_APP=/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app/dist/bb-app.js

ELECTRON_RUN_AS_NODE=1 /Applications/bb.app/Contents/MacOS/bb "$BB_APP" \
  --data-dir /tmp/bb-graphite-test/data \
  --server-port 19100 \
  --host-daemon-port 27100 \
  > /tmp/bb-graphite-test/bb-app.log 2>&1 &
```

- Run the entrypoint through `ELECTRON_RUN_AS_NODE=1` and the app's own binary. BB's
  native SQLite binding is built for Electron's ABI; a system `node` is the wrong
  runtime for it.
- `--data-dir`, `--server-port`, and `--host-daemon-port` are real flags on
  `bb-app`. Confirm with `bb-app --help`.
- The live instance holds `38886` and `38887`. Pick ports that collide with neither
  those nor an existing `~/.bb-dev/*` instance. Check with
  `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
- The process prints `bb is ready` with its app URL, daemon port, data dir, and log
  path. It starts both the server and the host daemon.

## Point the CLI at it

```sh
export BB_SERVER_URL=http://127.0.0.1:19100
export BB_DATA_DIR=/tmp/bb-graphite-test/data
```

- Both variables are needed. `BB_SERVER_URL` routes the request; `BB_DATA_DIR`
  selects the data directory.
- Confirm isolation before trusting a test: `bb plugin list --json` must show
  builtins only, and `bb project list --json` must be empty.
- Unset both, or use `env -u BB_SERVER_URL -u BB_DATA_DIR bb …`, to address the live
  instance from the same shell.

## Credentials and project bindings

A fresh data directory starts empty. Verified: builtins only, no projects, Connect
unpaired. Provider credentials, projects, and environments must be re-established in
the new data directory before any test that needs them.

## Stop it

```sh
ELECTRON_RUN_AS_NODE=1 /Applications/bb.app/Contents/MacOS/bb "$BB_APP" \
  stop --data-dir /tmp/bb-graphite-test/data
```

Verified: stops the server and daemon by the data directory's lock and leaves the
live instance running.

## The development loop

```sh
bb plugin build          # compile to dist/; no server required
bb plugin install . --yes  # install from the local path
bb plugin dev            # watch sources, rebuild, reload on change
bb plugin logs graphite  # read bb.log output
bb plugin reload graphite
```

- `bb plugin install` refuses without `--yes`, because a plugin is full-trust server
  code.
- Verified end to end against the isolated instance: install reported
  `graphite@0.1.0 running`, and `bb graphite --help` returned the plugin's own usage.
- `bb plugin build` must succeed before install or release.

## A scratch stack to test against

The plugin needs a real Graphite stack with at least two stacked branches plus trunk,
so that a trunk row and child rows both exist in `.graphite_metadata.db`. Create one
in a throwaway repository rather than against real work — step 5 of the plan runs
destructive verbs.

`/tmp/gt-scratch-20260918` is such a repository: trunk `main`, a branching stack
(`feat-a` with children `feat-b` and `feat-c`), one branch deliberately left needing
a restack, and a linked worktree at `/tmp/gt-scratch-wt-20260918` for exercising the
`--git-common-dir` path.
