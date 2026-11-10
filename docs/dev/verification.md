# Verification

## Repository checks

Use Bun **1.3.14**, pinned by `packageManager` in the root [`package.json`](../../package.json), and real Node **24.x**, declared in [`.node-version`](../../.node-version). Node's major version is the supported policy; patch updates within 24 are allowed. [CI](../../.github/workflows/ci.yml) reads those same files. Node is required because plugin suites exercise `node:sqlite` and run TypeScript through Node's test runner.

Install the pinned actionlint as described below. Install dependencies once with `bun install --frozen-lockfile --ignore-scripts`, then run the same entry point locally and in CI:

```sh
bun run verify
```

The preflight prints the actual Bun and Node executable paths and versions. It rejects a mismatched Bun version, a Node major other than 24, missing Node, or Bun masquerading as Node before any gate runs. Select the required runtimes with your preferred runtime manager and put them on `PATH`; for example, if using mise:

```sh
mise install bun@1.3.14 node@24
env PATH="$(mise where bun@1.3.14)/bin:$(mise where node@24)/bin:$PATH" bun run verify
```

Verification never installs or upgrades runtimes. It invokes the existing `format:check`, `lint`, `lint:workflows`, `check`, `test`, and `build` scripts in order, stops at the first failure, preserves its exit code, and summarizes passed, failed, and not-run gates. Nested package scripts inherit the validated runtime paths. Do not use `bun --bun` to substitute Bun for Node.

The root test command runs the included plugin suites plus explicit `./scripts/*.test.mjs` paths. Keep that path boundary: Bun treats a bare `scripts/` argument as a filter and can also discover tests inside ignored reference clones. Graphite and Worktree+ use `node --test`; repository scripts use `bun test`. Linear uses its own Vitest suite and is excluded from root formatting, lint, type checks, tests, and builds. Verification explicitly reports that exclusion. If changing Linear, run its package checks and report their results separately; a green root pipeline does not cover it.

Use focused checks during iteration, such as `bun test scripts/autolabel.test.mjs` or `bun run test` from the affected plugin directory. Complete `bun run verify` before pushing. If a check cannot run, record the limitation instead of claiming CI parity. Runtime preflight and failure propagation are covered by injected process execution in [`scripts/verify.test.mjs`](../../scripts/verify.test.mjs), without rerunning expensive gates in unit tests.

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

| Behavior                                               | Verification                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Parsing, state guards, path mapping                    | Pure functions with direct assertions                                                                        |
| Git state, worktree removal, subprocess lifetime       | Temporary real repositories and processes; verify preserved content and failure behavior                     |
| Repository API automation                              | Injected API client; test matching, pagination calls, race/error handling, and no mutation on rejected input |
| Plugin registration, RPC schemas, host signal delivery | Public SDK test harness supported by the package's SDK pin                                                   |
| UI layout, host selection, routing, install/reload     | Live check against an isolated BB instance                                                                   |

The current SDK provides `@get-bb/plugin-sdk/testing`, `/testing/host`, and `/testing/app`. Use the installed `bb-plugin-authoring` testing references and the package's declarations before adopting a harness; older pins may lack those exports. Keep pure logic tests independent of a running daemon. Existing fixtures in [Worktree+](../../plugins/wt/lib/fixture.ts) and [Graphite](../../plugins/graphite/lib/stack/fixture.ts) are examples, not a mandate to replace the package's test runner.

Build success verifies bundle generation, not live behavior. Keep backend, host, frontend, and live coverage distinct in a handoff. Existing SDK warnings should be reported as compatibility debt; a warning is not evidence that an obsolete call is the preferred implementation.

## Live testing

For frontend changes, use the [UI review matrix](ui-ux.md#ui-review-and-verification) to cover theme, layout, keyboard/touch interaction, data states, and lifecycle behavior on the affected surface.

Build before installing or releasing a plugin. Use an isolated BB instance and disposable projects for development, especially for worktree creation/removal and stack write operations. Verify the CLI points to the intended instance before installing, reloading, or invoking a destructive operation. Keep the user's active instance and repositories outside that test scope unless the user has explicitly included them.

Graphite has an [isolated-instance helper](../../plugins/graphite/scripts/bb-test-instance.sh) and [historical setup notes](../../plugins/graphite/.agents/plans/20260918-init/testing-setup.md). Those notes were verified against BB 0.43.1 in September 2026, not against every current release. Check the installed entrypoints, flags, ports, and runtime before reusing the helper. Its `install` command targets Graphite specifically. The app's native SQLite binding may require the app's Electron runtime rather than system Node.

After the package is installed in the intended instance, `bb plugin dev` rebuilds and reloads it on changes. Exercise the affected CLI/RPC or UI flow and inspect plugin logs. Verify cancellation and disposal when changing resource ownership; a successful happy-path call alone does not test cleanup.
