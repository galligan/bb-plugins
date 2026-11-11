# Compatibility and gate coverage report

Run the read-only report from the repository checkout after `bun install`:

```sh
bun scripts/compatibility-report.mjs
bun scripts/compatibility-report.mjs --json
bun test ./scripts/compatibility-report.test.mjs
```

The report reads `plugins/*/package.json`, root workspace patterns and gate scripts, `.prettierignore`, and the optional `.node-version` policy file. It lists package versions, declared BB and SDK engine ranges, direct SDK and `bb-app` build-tool pins from both dependency sections, and root gate selection. It does not install dependencies, resolve the lockfile, invoke package scripts, access the running BB installation, or change files. Ranged dependencies are shown as declarations, not resolved versions. A missing direct SDK pin remains visible even if a transitive dependency happens to supply it.

The human output is for inspection; `--json` emits schema version 1 with stable field names and plugins sorted by directory. `policy` contains declared runtime policy; `gateCommands` preserves the configuration behind the assessment. Each plugin has `declared`, `pins`, `comparison`, `coverage`, `harness`, and actionable `diagnostics`. Diagnostics are advisory and exit successfully, because differing pins and deliberate exclusions are not universally invalid. Invalid input, unsupported command-line arguments, and unreadable/malformed manifests fail with exit code 1. Keep generated reports as CI or PR artifacts rather than committing an inventory that will become stale.

## Harness coverage and tooling drift

`harness` answers one question per plugin: can its entry files be verified without a live BB? For each entry the manifest declares under `bb.server`, `bb.host`, and `bb.app`, the value is:

| Value            | Meaning                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `covered`        | A `*.test.*` file that the package's `test` script runs imports the matching harness (`@get-bb/plugin-sdk/testing`, `/testing/host`, `/testing/app`) and that entry file |
| `unselected`     | Such a test exists, but the package's `test` script does not run it                                                                                                      |
| `missing`        | No such test exists                                                                                                                                                      |
| `not-applicable` | The manifest declares no such entry                                                                                                                                      |

`importScan` uses the same values for a test that calls `experimental_scanPublicSdkOnly`. Each `missing` or `unselected` value adds a diagnostic naming the entry, the harness, and the unselected file.

An import counts only when it resolves, relative to the test file, to the exact entry path in the manifest. An extensionless or `.js`-style specifier counts when it names no other real file and no other file shares the entry's stem. Test selection is read from the repository's command forms only: quoted `node --test` globs, and `vitest run` with the literal `include` globs in `vitest.config.ts`, or Vitest's default when there are none. A new runner form needs a reviewed change to [`harness.mjs`](../../scripts/compatibility/harness.mjs).

This is a static text signal read from sources. It runs nothing and does not judge assertions, so `covered` means a selected harness test loads the entry, not that the behavior is tested well. Fixtures and non-test files do not count. See [choose the test boundary](verification.md#choose-the-test-boundary) for what each harness can and cannot verify.

The top-level `toolingDrift` list names shared tooling (TypeScript, `better-sqlite3`, React, React DOM, Testing Library, jsdom, and Vitest) pinned to more than one version, across packages or across one package's two dependency sections. SDK pins are checked by [`bun run preflight`](verification.md#bb-and-sdk-versions), not here. Both fields are additive to schema version 1.

## Meaning of coverage

`included` means selected by a recognized root command, not that a gate ran or passed. `excluded` means omitted by workspace selection, a package filter, or source selection. `not-configured` means a selected package lacks the corresponding script. `unknown` means missing or unrecognized configuration; inspect the command and update the small adapter in [coverage.mjs](../../scripts/compatibility/coverage.mjs) with a regression test before relying on it.

The adapters recognize the repository's current Bun workspace filter commands, bounded repository-test suffix, Oxlint command with an optional whole-directory ignore, and `prettier . --check`. They intentionally do not interpret arbitrary shell commands. Formatting selection uses Prettier's own ignore/parser discovery on package source files; dependencies, `.git`, generated `dist` trees, and symlinks are omitted from that inventory. Individual ignored files do not imply that a whole package is excluded. Lint participation describes package selection, not individual rule or file coverage. Root gate selection is distinct from whether a CI workflow actually invokes those gates. This tool does not parse CI job graphs or claim CI execution evidence.

Exclusion is derived from the current configuration, not hard-coded into the report. Changing the filter/ignore configuration changes the assessment. No package is excluded today; a package can still lack a script, so inspect every reported diagnostic.

## Updating compatibility evidence

During an SDK or build-tool upgrade:

1. Run the report before and after the change. Review direct pins and declared engine ranges together. Numeric comparator, caret, tilde, and OR ranges are compared against exact pins; unsupported syntax remains unknown. A pin satisfying a range only proves manifest consistency. This repository keeps one SDK pin across packages; `bun run preflight` names any package that differs from the root.
2. Inspect the pinned public SDK contract and run the relevant package checks plus [repository verification](verification.md). Record the commit, actual executable paths and versions for Bun/Node, SDK/build pins, commands, and results in the PR. Record excluded or unrun gates explicitly.
3. Attach runtime compatibility evidence separately: actual BB host version, tested plugin version, exercised registration/lifecycle/UI flows, and outcomes. Use existing authorized test infrastructure. A build under the current runtime does not prove that the declared minimum BB or SDK version works; if that minimum was not exercised, say so.
4. Update declarations only when the package's support policy and evidence justify it. Resolve mismatches deliberately rather than automatically upgrading dependencies or copying another plugin's range.

`testedCompatibility` is always `not-established`: the report itself runs no tests and imports no historical claims. Keep exact tested versions and results in the upgrade PR/CI evidence, tied to the commit, so a later manifest edit cannot silently inherit an obsolete guarantee. The focused [fixtures](../../scripts/compatibility/fixtures.mjs) demonstrate old SDKs, either dependency section, and exclusions without maintaining a second package inventory.
