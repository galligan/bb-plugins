# Verification

## Repository checks

Use Bun **1.4.4**, pinned by `packageManager` in the root [`package.json`](../../package.json), and real Node **24.x**, declared in [`.node-version`](../../.node-version). Node's major version is the supported policy; patch updates within 24 are allowed. [CI](../../.github/workflows/ci.yml) reads those same files. Node is required because plugin suites exercise `node:sqlite` and run TypeScript through Node's test runner.

Every package and the scaffold pin the same exact TypeScript, **7.0.2**, and `oxlint` and `prettier` are pinned exactly at the root. When a newer stable release of Bun or one of these tools is adopted, change every pin in one pull request and regenerate `bun.lock` with that Bun; the [compatibility report](compatibility-report.md#harness-coverage-and-tooling-drift) names a package whose TypeScript pin differs.

Install the pinned actionlint as described below. Install dependencies once with `bun install --frozen-lockfile --ignore-scripts`, then run the same entry point locally and in CI:

```sh
bun run verify
```

The preflight prints the actual Bun and Node executable paths and versions. It rejects a mismatched Bun version, a Node major other than 24, missing Node, or Bun masquerading as Node before any gate runs. Select the required runtimes with your preferred runtime manager and put them on `PATH`; for example, if using mise:

```sh
mise install bun@1.4.4 node@24
env PATH="$(mise where bun@1.4.4)/bin:$(mise where node@24)/bin:$PATH" bun run verify
```

Verification never installs or upgrades runtimes. It invokes the existing `format:check`, `lint`, `lint:workflows`, `check`, `test`, and `build` scripts in order, stops at the first failure, preserves its exit code, and summarizes passed, failed, and not-run gates. Nested package scripts inherit the validated runtime paths. Do not use `bun --bun` to substitute Bun for Node.

The root test command runs the included plugin suites plus explicit `./scripts/*.test.mjs` paths. Keep that path boundary: Bun treats a bare `scripts/` argument as a filter and can also discover tests inside ignored reference clones. Each plugin's `test` script runs its `node --test` suites and then, where it has a frontend, Vitest; repository scripts use `bun test`.

Use focused checks during iteration, such as `bun test scripts/autolabel.test.mjs` or `bun run test` from the affected plugin directory. Complete `bun run verify` before pushing. If a check cannot run, record the limitation instead of claiming CI parity. Runtime preflight and failure propagation are covered by injected process execution in [`scripts/verify.test.mjs`](../../scripts/verify.test.mjs), without rerunning expensive gates in unit tests.

## BB and SDK versions

This repository tracks the latest stable BB, the latest `@get-bb/plugin-sdk` on npm with one exact pin in every package, and the latest stable Bun and TypeScript. Before plugin work, run:

```sh
bun run preflight
```

It reads these facts and changes nothing:

| Fact                                                                         | Source                            | When it is behind                                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Installed BB against the latest stable release                               | `bb updates status --json`        | Exit 1. Stop and tell the user; update with `bb updates app`. A development or nightly build counts as not stable. |
| SDK that the installed BB bundles                                            | `bb plugin types --check`         | Informational; see below.                                                                                          |
| Repository SDK pin against npm latest, and each package against the root     | `package.json` files, `npm view`  | Exit 2. Report it; continue unless the task needs the newer SDK.                                                   |
| Repository Bun pin against npm latest                                        | root `packageManager`, `npm view` | Exit 2. Report it and continue; moving it is a change of its own (see [repository checks](#repository-checks)).    |
| Repository TypeScript pin against npm latest, one exact pin in every package | `package.json` files, `npm view`  | Exit 2. Report it and continue, as for Bun.                                                                        |

A check that cannot run, such as no `bb` on `PATH` or npm unreachable, is reported as not checked and does not fail. After one registry lookup fails, the remaining ones are skipped and reported the same way, because npm can take over a minute to give up on each. npm's `latest` tag is the stable release; an answer that is not a plain release version, such as a beta, is treated as not checked. [`.bb-env-setup.sh`](../../.bb-env-setup.sh) runs the command when BB creates a worktree and ignores its exit code, so a finding is recorded in the provisioning transcript without blocking the worktree. It is not part of `bun run verify` or CI: the SDK publishes alongside BB nightlies, often daily, and CI has no BB. This command is separate from the Bun and Node runtime preflight inside `bun run verify`.

The pin is usually ahead of the bundled SDK, because stable BB ships less often than the SDK publishes. That gap is expected and is not a reason to lower the pin. It does mean npm latest alone proves nothing about the stable runtime: before relying on an API newer than the bundled SDK, check the current public contract and get harness or live evidence that the installed BB supports it. `bb plugin types` and `bb plugin new` on stable BB write the bundled version, not the repository pin. Inspect that diff and reconcile it deliberately; never accept a lower pin as a side effect.

To bump the SDK, set every `@get-bb/plugin-sdk` pin to npm latest (the root, each plugin, and `scaffolds/nav-panel`), run `bun install`, follow the [scaffold maintenance steps](../../scaffolds/README.md#maintenance-and-evidence), and run `bun run verify`. Keep each package's `bb.engines.bbPluginSdk` at the lowest version it actually needs. The check's cases are covered with injected process execution in [`scripts/preflight.test.mjs`](../../scripts/preflight.test.mjs).

## Workflow lint

`bun run lint:workflows` requires actionlint **1.7.12**, pinned in [`.actionlint-version`](../../.actionlint-version). The wrapper checks that version and passes only tracked `.github/workflows/*.yml` and `*.yaml` files to actionlint. Stage a new workflow before checking it. Missing/wrong actionlint and discovery failures fail the gate with a diagnostic; verification never installs it for you.

Install from the [official actionlint release](https://github.com/rhysd/actionlint/releases/tag/v1.7.12), or build the pin with Go 1.25+ into an explicit temporary directory without changing global tools:

```sh
actionlint_bin="$(mktemp -d)"
GOBIN="$actionlint_bin" go install "github.com/rhysd/actionlint/cmd/actionlint@v$(cat .actionlint-version)"
export PATH="$actionlint_bin:$PATH"
bun run lint:workflows
```

CI installs the same pin with Go before invoking `bun run verify`. Optional ShellCheck and Pyflakes integrations are disabled explicitly so their presence on one host cannot change this gate; this check covers Actions YAML, expressions, and action/job structure, not embedded shell/Python analysis or GitHub execution. CI needs only `contents: read` permission.

[`scripts/lint-workflows.test.mjs`](../../scripts/lint-workflows.test.mjs) uses a temporary Git repository and the real pinned binary to prove a valid tracked workflow passes, an invalid expression fails, and untracked files do not widen the boundary. These root script tests also require actionlint on `PATH`. The [autolabel default-branch regression test](../../scripts/autolabel-workflow.test.mjs) remains in the root test suite: workflow lint complements behavior tests and cannot establish that a checkout uses the intended trust boundary.

To update actionlint, change `.actionlint-version`, update the version and release link here, install the new pin, and run the complete verification command. Review lint changes alongside the upgrade; no automatic global updates occur.

## Choose the test boundary

Verify behavior in a test before starting BB. The public SDK harnesses load a plugin's real entry files in-process, with no daemon, app, or network. Use a live instance only for the last row of this table.

| Behavior                                                                                                                                                      | Verification                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Parsing, state guards, path mapping                                                                                                                           | Pure functions with direct assertions                                                                        |
| Git state, worktree removal, subprocess lifetime                                                                                                              | Temporary real repositories and processes; verify preserved content and failure behavior                     |
| Repository API automation                                                                                                                                     | Injected API client; test matching, pagination calls, race/error handling, and no mutation on rejected input |
| Server registration, RPC, CLI, HTTP and WebSocket routes, agent tools, services, schedules, settings changes, thread events, install, reload, and disposal    | `createFakePluginHost` from `@get-bb/plugin-sdk/testing`, loading the real `server.ts`                       |
| Host-entry calls, signals, cancellation, and disposal                                                                                                         | `experimental_createHostEntryHarness` from `@get-bb/plugin-sdk/testing/host`, loading the real `host.ts`     |
| Frontend registration and slot behavior: loading, empty, error/retry, pending and failed writes, keyboard activation, navigation and RPC calls, and reconnect | `loadPluginApp` and `renderSlot` from `@get-bb/plugin-sdk/testing/app`, loading the real `app.tsx`           |
| Imports limited to the public SDK                                                                                                                             | `experimental_scanPublicSdkOnly` in one package test, asserting no violations or private dependencies        |
| Layout and CSS, themes, real routing, host selection, crash isolation, other plugins, worker startup and crashes, enforced HTTP auth, restart timers and cron | Live check against an isolated BB instance                                                                   |

A package that has the entry file covers it with the matching harness: the server factory with its registrations asserted, the host entry, the app's registrations, and the import scan. [Graphite's server](../../plugins/graphite/lib/server.test.ts) and [host-entry](../../plugins/graphite/lib/host-entry.test.ts) tests, [Radio's frontend tests](../../plugins/radio/tests/), and the [bbots import scan](../../plugins/bbots/lib/server.test.ts) are working examples. Every package covers each entry it declares; [`bun scripts/compatibility-report.mjs`](compatibility-report.md#harness-coverage-and-tooling-drift) shows the current state per plugin and names any gap. A new entry file gets its harness test in the same change, not a live check.

Every package that depends on the public SDK can import all three entrypoints; the [compatibility report](compatibility-report.md) lists current pins. Check the package's pinned declarations and the `bb-plugin-authoring` testing references before using a harness member, because `experimental_` names can change between releases.

Follow the SDK's own test setup. Its README and `@get-bb/plugin-sdk/testing/app` declarations document frontend tests under Vitest with jsdom (`// @vitest-environment jsdom`), so frontend suites use that, as [Radio](../../plugins/radio/vitest.config.ts) and the [nav-panel scaffold](../../scaffolds/nav-panel/app.test.tsx) do. The backend and host-entry harnesses are framework-independent. The SDK's examples use Vitest; this repository's existing `node --test` suites remain valid, and a package keeps one backend runner rather than mixing two. `bb plugin new` adds no test runner, so each package declares its own: `better-sqlite3` for backend harness tests, and React, React DOM, Testing Library, and jsdom for frontend tests. Never mock plugin storage: the fake host supplies a real temporary database.

Keep pure logic tests independent of both the harness and a running daemon. Existing fixtures in [Worktree+](../../plugins/wt/lib/fixture.ts) and [Graphite](../../plugins/graphite/lib/stack/fixture.ts) are examples, not a mandate to replace the package's test runner.

Build success verifies bundle generation, not live behavior. Keep backend, host, frontend, and live coverage distinct in a handoff. Existing SDK warnings should be reported as compatibility debt; a warning is not evidence that an obsolete call is the preferred implementation.

## Live testing

Go live only for a boundary the table above assigns to a live check, and name that boundary in the handoff. A live check does not replace a harness test for behavior the harness can drive.

For frontend changes, use the [UI review matrix](ui-ux.md#ui-review-and-verification) to cover theme, layout, keyboard/touch interaction, data states, and lifecycle behavior on the affected surface.

Build before installing or releasing a plugin. Use an isolated BB instance and disposable projects for development, especially for worktree creation/removal and stack write operations. Keep the user's active instance and repositories outside that test scope unless the user has explicitly included them.

Name the instance for every command sent to it, read-only ones included:

```sh
bun run bb-target --url <server-url> --data-dir <path> [--daemon-port <port>] [--cli <bb-entry>] [--thread <thread-id>] -- <bb arguments>
```

[`scripts/bb-target.mjs`](../../scripts/bb-target.mjs) first asks the server at that URL which data directory it serves, and forwards the command only if the answer is the directory named. Three things make that necessary:

- Inside a bb thread, inherited `BB_*` variables point the CLI at the instance the thread runs in. The command drops all of them and sets only the target it was given.
- A URL alone does not identify an instance: a port can be forwarded or reused. The data directory the server reports does.
- The default instance must not be reachable by mistake. The command refuses port 38886, the default server port, on every host, and `~/.bb` in any spelling of the path. It refuses the port everywhere because a hostname can reach this machine in more spellings than can be listed, and an isolated instance has no reason to use it.

It runs one command and returns its exit code. It does not start, stop, install, reload, or retry anything, and it never prints the forwarded arguments. Pass `--cli` when the instance needs its own CLI entry, such as a source build's `dist/bb.js`; pass `--daemon-port` when it has its own host daemon. A command runs with no thread or project unless `--thread` names one: the bb CLI tells a plugin command who called it only from `BB_THREAD_ID` and `BB_PROJECT_ID`, which this command drops. With `--thread`, it first asks the instance for that thread, refuses if the instance does not have it, and then sets both variables from the thread's own record, so the plugin sees a real caller on that instance and never one inherited from the shell. How an isolated instance is created is outside this repository. Its cases are covered with injected process execution in [`scripts/bb-target.test.mjs`](../../scripts/bb-target.test.mjs).

Say what kind of instance produced live evidence. One built from source is evidence for that commit; it does not establish compatibility with the released binary that reports the same version.

To show that a built plugin directory starts on an isolated instance, without leaving it there:

```sh
bun run load-check --url <server-url> --data-dir <path> [--daemon-port <port>] [--cli <bb-entry>] --plugin <id> --artifact <built-plugin-dir> --original <current-plugin-dir> --receipt <file> [-- <read-only bb arguments>]
```

This works only for a plugin that the instance already runs, enabled, from a local path. `bb plugin install <path>` over such an install is a move that bb supports: it keeps settings, secrets and schedules, and keeps the old install if the new checkout fails to start. [`scripts/load-check.mjs`](../../scripts/load-check.mjs) names the instance through the same checks as `bb-target`, then:

1. Refuses, changing nothing, unless the plugin runs from `--original`, both directories hold the same package, and no plugin install is queued or running.
2. Sends one install of `--artifact`, then reads the install queue and the plugin list to learn what happened. An install command that times out may still have been accepted, so the command's exit alone never decides, and no install is sent twice. If the command gave no exit and the plugin still runs from the original path after a short watch, the run ends with exit 4, not 1, because the install may still arrive.
3. If the plugin runs from the artifact, runs the optional command after `--` once. That command must be read-only; its arguments are never printed or recorded, and its output is written beside the receipt.
4. Sends one install of `--original` and checks that the plugin runs from there again.

| Exit | Meaning                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0    | The plugin ran from the artifact and runs from the original path again.                                                          |
| 1    | bb did not run the artifact, or the probe failed. The original install is verified running.                                      |
| 3    | Refused before any install.                                                                                                      |
| 4    | The final state is not verified as the original install: read the receipt and `plugin list --json` before sending anything else. |

The receipt is JSON, rewritten after every step (and printed at the end if it could not be written), with the baseline, what was observed on the artifact, the final state, and both the first failure and any restore failure. The restore runs after an ordinary failure of the script. It cannot run if the process is killed or the machine is lost between the two installs; the plugin then stays on the artifact, and the receipt's `restoreArguments` are the bb arguments that move it back.

A pass shows that bb registered the plugin from the artifact and reports it running. Only the probe exercises a host entry, and nothing here renders the app. A plugin installed from git or npm cannot be checked this way: bb refuses to replace that source in place, and removing the plugin first deletes its settings, secrets and schedules. The cases are covered with injected process execution in [`scripts/load-check.test.mjs`](../../scripts/load-check.test.mjs).

Graphite's former [isolated-instance script](../../plugins/graphite/scripts/bb-test-instance.sh) is retired: it exits with a notice and starts nothing. Its [setup notes](../../plugins/graphite/.agents/plans/20260918-init/testing-setup.md) describe BB 0.43.1 in September 2026 and are kept as history, not as a procedure. Use an instance provided for the purpose, reached through `bb-target`. One caution from those notes still applies to anyone running BB's server from the installed app: its native SQLite binding is built for the app's Electron runtime, not system Node.

After the package is installed in the intended instance, `bb plugin dev` rebuilds and reloads it on changes. Exercise the affected CLI/RPC or UI flow and inspect plugin logs. Verify cancellation and disposal when changing resource ownership; a successful happy-path call alone does not test cleanup.
