# Plugin patterns

## Package boundaries and API versions

Each directory under `plugins/` is a standalone package. Its manifest owns its entries, dependencies, SDK version, compatibility ranges, and release version. The root workspace coordinates checks; it is not a shared runtime. See the [collection manifest](../../.bb/plugins.json) for the packages currently advertised for installation.

Read the affected `package.json` before copying an example. Every package pins the same exact SDK, tracked to npm latest; see [BB and SDK versions](verification.md#bb-and-sdk-versions). That pin can be ahead of the SDK the installed BB bundles, so a successful build does not validate an API against the stable runtime. `bb plugin types` in a package syncs the type-only dependencies of the packages BB shims and repins the SDK to the running BB's version. Review the resulting dependency and manifest changes, keep the repository's SDK pin unless lowering it is the point of the change, and verify the affected behavior.

Imported symbols must come from public `@get-bb/plugin-sdk` entrypoints. BB's own plugins can use internal packages that independently distributed plugins cannot. Copy the design of an internal example only after identifying the public equivalent; do not import `@bb/*` internals or reach into a neighboring checkout. The installed `bb-plugin-authoring` skill routes to the current backend, frontend, testing, and distribution references.

## Server, host, and frontend responsibilities

The bb server and the machine containing an environment can be different machines. A checkout path is meaningful on its owning host. Run Git, filesystem operations, and checkout-local commands through the plugin's host entry with the correct `hostId`, cancellation signal, and bounded execution time. Resolve tools on that host instead of assuming the server's `PATH` applies.

Worktree+ provides a concrete split:

- [`server.ts`](../../plugins/wt/server.ts) registers the provider, settings, RPC, and CLI, and passes work to the selected host.
- [`host.ts`](../../plugins/wt/host.ts) adapts typed calls to host-local operations and disposes running scripts.
- [`lib/host-contract.ts`](../../plugins/wt/lib/host-contract.ts) defines the input/output schemas and progress signals shared by both sides.
- [`lib/worktree.ts`](../../plugins/wt/lib/worktree.ts) implements the behavior with injected paths, cancellation, and progress reporting.
- [`app.tsx`](../../plugins/wt/app.tsx) uses BB's branch picker for host-owned branch selection.

Parse untrusted input at the boundary. Keep frontend parameters, persisted values, and host responses behind explicit schemas; carry typed values internally. Keep secret settings on the server rather than in frontend props or provider inputs. Bound command output as well as execution time, and propagate cancellation to the work being performed.

## Git reads and compatibility code

For new code using the current SDK, the bundled Git plugin (`bb--git`) owns environment status and diffs. Inspect its live contract with `bb plugin rpc inspect bb--git`; server code calls it through `bb.sdk.plugins.callRpc`. For a single environment's status, the replacement method is `workspaceStatus`. Copy only the response contract the caller needs, and handle unavailable or failed reads explicitly.

Graphite reads status this way in [`lib/current-stack.ts`](../../plugins/graphite/lib/current-stack.ts): `workspaceStatus` on `bb--git` through `bb.sdk.plugins.callRpc`, parsed with its own schema. The write guard in [`lib/verbs.ts`](../../plugins/graphite/lib/verbs.ts) depends on that result, so a failed or unavailable read refuses the write. `bb.sdk.environments.status` is the retired method it replaced; do not use it in new code, and do not assume the two response contracts are identical when migrating a caller.

Use host-side commands for information the public service does not provide. Graphite's metadata reader in [`lib/stack/`](../../plugins/graphite/lib/stack/) is one such case: it reads stack relationships without running `gt log` or `gt ls`, which refresh metadata and can destroy the staleness signal being inspected.

## Surface choices and cleanup

For surface selection, registry controls, host-owned interactions, theming, and accessibility, follow [Plugin UI and UX](ui-ux.md). Its reuse order is host-rendered contribution, public capability component, BB registry control, then custom composition.

Keep registration files and UI surfaces thin so CLI, agent tools, and UI can share behavior without importing one another. Use the smallest surface that exposes the intended decision: a command for an operation, a schema-defined tool for agent input, or a visible control when a person needs to choose or inspect state. Prefer SDK components and navigation for behavior owned by BB; keep plugin-owned controls within the plugin package.

Follow each registration's lifecycle contract. Dispose resources the plugin owns, including child processes, subscriptions that require explicit disposal, and retained host workers. Remove per-operation progress routing in `finally` blocks; Worktree+'s `reports` map is an example. A timeout or cancelled UI request does not prove that a child process has stopped.
