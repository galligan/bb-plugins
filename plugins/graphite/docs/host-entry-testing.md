# Graphite host-entry tests

## Reproduction and cause

Reproduced on Linux x64 at repository baseline
`25e54b1438cd89cb5fb7e509e3ca586898d6873a`, using Node `v24.22.2`, Bun
`1.3.14` (`0d9b296a`), and Graphite's unchanged public
`@get-bb/plugin-sdk@0.4.87` dependency. From `plugins/graphite`:

```sh
node --version
bun --version
node --input-type=module -e 'console.log(process.version); await import("./host.ts")'
```

The last command failed during module evaluation, before a handler or the public
test harness could run. Stack below abbreviates only the installed package path
as `<sdk>`; runtime frames and line/column numbers are preserved. Here `<sdk>` was
`node_modules/.bun/@get-bb+plugin-sdk@0.4.87+483e68f3d9ae5688/node_modules/@get-bb/plugin-sdk`
under the repository root:

```text
Error: Dynamic require of "child_process" is not supported
    at file:///<sdk>/dist/host.js:11:9
    at ../../node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/index.js (file:///<sdk>/dist/host.js:515:14)
    at __require2 (file:///<sdk>/dist/host.js:15:52)
    at file:///<sdk>/dist/host.js:15084:34
    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)
    at async node:internal/modules/esm/loader:647:26
    at async file:///<repo>/plugins/graphite/[eval1]:1:31
```

The package's export map resolves `@get-bb/plugin-sdk/host` to `dist/host.js`.
That ESM bundle evaluates bundled `cross-spawn@7.0.6`, which attempts a CommonJS
`require("child_process")` through its generated require helper. A smaller repro
still fails after the Graphite fix, isolating the SDK subpath from plugin code:

```sh
node --input-type=module -e 'await import("@get-bb/plugin-sdk/host")'
```

Bun is not a replacement test runtime here. With Bun `1.3.14`:

```sh
bun -e 'await import("@get-bb/plugin-sdk/host")' # succeeds
bun -e 'await import("./host.ts")'             # fails, before and after the fix
```

```text
error: No such built-in module: node:sqlite

Bun v1.3.14 (Linux x64)
```

Graphite's metadata reader uses `node:sqlite`. Repository gates deliberately use
Bun for installation/orchestration and Node 24 for Graphite's tests. Both runtime
results above are module-import evidence, not a live BB host failure report.

## Supported fix, unchanged compatibility

The same pinned SDK publicly exports `experimental_defineHostEntry` from its
root, in both `bundled-types/bb-plugin-sdk.d.ts` and `dist/index.js`. The installed
BB `0.43.3` authoring references list it as a root runtime export. That root is a
small contract-only entrypoint: it does not load the host utility bundle or
`cross-spawn`. Graphite needs only this helper, so `host.ts` now imports it from
`@get-bb/plugin-sdk`, as `lib/host-contract.ts` already does for `defineRpcContract`.

No SDK/BB upgrade, engine-range change, lockfile change, private import, require
shim, or generated-output edit is needed. The entry API version, contract,
handlers, cancellation forwarding, and build command remain unchanged. After
the fix, the original Node host import succeeds. The SDK's broader `/host`
packaging remains unchanged; this consumer fix does not repair that subpath for
plugins needing its other utilities.

BB builds and loads generated host artifacts rather than this direct TypeScript
test import. The generated host artifact also imports successfully on Node
`24.22.2` and exposes entry API version 1. The build emits its own supported SDK
runtime adapter and CommonJS interop banner; this fix adds neither. Build and
artifact-import success do not verify a running daemon's behavior. No BB
installation was modified or live production failure inferred.

## Regression boundary

Run with Node 24 on `PATH`:

```sh
node --test lib/host-entry.test.ts
bun run test
```

[`lib/host-entry.test.ts`](../lib/host-entry.test.ts) dynamically imports the real
`host.ts`, then drives it through the pinned public
`@get-bb/plugin-sdk/testing/host` harness. The suite fails on the original import
and passes with the root import. It exercises:

- The actual entry contract and real Git/SQLite stack metadata.
- Invalid stack/CLI-host inputs and a typed missing-repository result.
- Host-local `cwd`, `--no-interactive`, stdout/stderr, and nonzero exits.
- Request cancellation and harness disposal terminating a real fixture process.
- Idempotent disposal, stale-call rejection, and a fresh harness after disposal.

The CLI is an offline executable fixture, never the user's installed `gt`.
Only home-directory discovery is mocked during entry import so `runGt` finds
that fixture first; the SDK, host entry, schemas, subprocess execution, and
cancellation are real. The temporary mock is restored immediately. No credentials
or daemon are used. Graphite declares no watches, retained-worker leases,
settings, or custom dispose hook, so the tests do not invent those resources.

This separate host-entry file does not replace or edit the server-factory tests
from [BBP-31 / PR #45](https://github.com/galligan/bb-plugins/pull/45), or their
README handoff. It addresses [BBP-33 / issue #40](https://github.com/galligan/bb-plugins/issues/40).
Daemon worker startup/crashes/reconnect, descendant process trees, live
install/reload, UI behavior, and actual Graphite CLI compatibility remain outside
this in-process harness. Linear remains excluded from root verification.
