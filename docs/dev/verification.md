# Verification

## Repository checks

Use the Bun version pinned in the root [`package.json`](../../package.json). [CI](../../.github/workflows/ci.yml) also uses Node 24 because the plugin tests exercise `node:sqlite` and run TypeScript through Node's test runner. CI installs with `bun install --frozen-lockfile --ignore-scripts` and then runs:

```sh
bun run format:check
bun run lint
bun run check
bun run test
bun run build
```

The root test command runs the included plugin suites plus explicit `./scripts/*.test.mjs` paths. Keep that path boundary: Bun treats a bare `scripts/` argument as a filter and can also discover tests inside ignored reference clones. Graphite and Worktree+ use `node --test`; repository scripts use `bun test`. Linear uses its own Vitest suite and is excluded from root formatting, lint, type checks, tests, and builds. If changing Linear, run its package checks and report their results separately; a green root pipeline does not cover it.

Use focused checks during iteration, such as `bun test scripts/autolabel.test.mjs` or `bun run test` from the affected plugin directory. For workflow changes, run `actionlint` when available. Complete the root gates before pushing. If a tool version differs from the pin or a check cannot run, record that limit instead of claiming CI parity.

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
