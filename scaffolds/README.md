# Collection nav-panel scaffold

This is one vendored composition for an independently built BB plugin: a host-owned nav-panel title and Refresh action, a list, and inline item details with an acknowledged mutation. It adds no router, React root, shared runtime package, toaster, or secret editor. The two consumers are offline examples, not product integrations.

## Generate and verify

Use Bun 1.3.14 and Node 24 (the repository CI runtimes). The template began with `bb plugin new collection-example` on BB 0.49.0; its public SDK pin is 0.6.132. Generation itself requires only Node and does not install dependencies or touch BB. From the repository root:

```sh
mkdir -p scaffolds/.generated
node scripts/ui-scaffold.mjs create scaffolds/consumers/worktrees.json scaffolds/.generated/worktrees
node scripts/ui-scaffold.mjs create scaffolds/consumers/verdicts.json scaffolds/.generated/verdicts
cd scaffolds/.generated/worktrees
bun install --frozen-lockfile
bun run check
bun run test
bun run build
```

Repeat install/check/test/build in `scaffolds/.generated/verdicts`. Both packages contain their own source, manifest, registry recipes, lockfile and SDK dependency; neither imports the template, another plugin, or BB internals. React/React DOM are test development dependencies; `bb plugin build` uses BB's shared runtime. The generated directory must not already exist. Do not install these examples into a running BB for routine verification.

Root `bun run test` includes the generation/update preservation regression through the existing scripts glob. Root plugin check/build commands do not discover `scaffolds/`: the two generated-package checks above are additional required gates when this scaffold changes. No root scripts, plugin dependencies or verification policy are changed by this lane.

## Observed consumer boundary

Inventory at repository base `25e54b1438cd89cb5fb7e509e3ca586898d6873a`:

| Consumer                                                  | Observed need                                                                                    | Reusable boundary                                                                 | Stays product-owned                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [Worktree+](../plugins/wt/components/worktrees-panel.tsx) | Management list with refresh, per-host failure and row operations                                | Host nav panel, retained data during failed refresh, selection and pending action | Host targeting, rescue details, destructive confirmation and core-owned removal |
| [Judge](../plugins/judge/docs/SPEC.md)                    | Planned verdict UI over bounded run records; native connection secret settings already specified | Collection list/details and explicit reviewed state                               | Privacy, calibration, model choice, verdict semantics and outcome eligibility   |

The collection boundary is intentionally smaller than either product. Judge's UI need is a documented planned surface, not an existing implementation. Worktree+ and Judge owners need no paused writers for these read-only observations; the parent coordinator authorized fixture consumers and deferred adoption. The fixtures mark an in-memory item reviewed; they never remove worktrees, invoke models, execute outcomes, read credentials, or persist real product data.

## Adopt

Generate a new package first, inspect it, then adapt its package-local files on a branch. Preserve the target plugin's identity and settings if copying into an existing package. Replace `server.ts`'s explicitly offline adapter and `contract.ts` with bounded real data. Use SDK query/mutation hooks and server-side tag invalidation for every writer. The shared read retains data during refresh errors; writes are not retried automatically. Keep existing content while pending, prevent duplicate writes, and retain selection on failure.

Credentials belong in declared server-side secret settings rendered by BB, never `consumer.json`, RPC rows, or a custom form. Use public navigation, links, panel tabs and capability components when adding host-owned actions. The inline detail view needs no overlay; if an adopter needs a dialog, vendor the release-matched `@bb/dialog` with its portal/support files. Do not build another shell or overlay provider.

Buttons come from the release-matched scaffold registry, with its focus ring, semantic tokens and coarse-pointer sizing helper. The layout stacks list and details at every width, wraps long names, and scrolls within the nav panel. Native buttons support keyboard activation; selection does not move focus on passive refresh. These design choices still require real host verification.

## Explicit updates without overwrites

`scaffold.json` records the adopted revision, SDK/BB baseline, registry provenance, original consumer configuration and SHA-256 hashes of every generated source file. `provenance.json` travels with the source. Keep both in Git. The scaffold's revision is an immutable source version: maintainers increment it for every shipped template change; the delivery commit/PR identifies its repository revision.

```sh
node scripts/ui-scaffold.mjs update path/to/adopted-package path/to/new-candidate
# Exit 1 here means differences, as usual for git diff --no-index.
git diff --no-index path/to/adopted-package path/to/new-candidate
```

The candidate must be a new directory outside the adopted package. Updates never write to the adopted package, including its provenance. The report classifies each source file as `unchanged`, `upstream` (only upstream changed), `customized` (only local changed), or `conflict` (both changed differently). Deletions are changes too. Extra plugin-owned files are untouched. There is deliberately no force/overwrite or automatic merge mode.

Review the diff and manually merge selected changes into the adopter's branch, keeping local behavior, identity and dependency choices. If accepting the complete new baseline, copy the candidate's `scaffold.json` after the merge; its hashes must remain the upstream candidate hashes, not hashes of customized merged files, so the next update can still detect customization. If deferring part of the update, keep the previous baseline and document the partial adoption in the PR. Re-run package checks and host validation before accepting. Customized `consumer.json` is also a review conflict; update the consumer record deliberately when changing the baseline configuration.

The preservation test simulates a revision-2 upstream edit against a customized revision-1 consumer, checks conflict reporting, byte-for-byte local preservation and extra-file preservation, and rejects nested/aliased candidate directories. The output is a review proposal, not proof that local customizations remain compatible with new APIs.

## Maintenance and evidence

The bb-plugins maintainers own this scaffold; consumer owners own their vendored copies and adoption PRs. Before updating the SDK or BB release, run `bb plugin new` in a disposable directory and compare public SDK declarations and release-matched registry recipes. Review changes to Button, motion, coarse-pointer helpers and utilities together. Update `components.json`, `provenance.json`, exact SDK dependency and the lockfile deliberately, increment the revision, and run both consumer gates plus repository gates. Do not fetch latest recipes automatically or upgrade sibling packages.

Public SDK rendering tests cover registration, loading, empty results, error/retry, retained stale rows, keyboard activation, duplicate-write suppression, failed-write selection preservation and successful read reconciliation. The harness drives reconnect to emulate refreshed reads; it does not run the fixture server or prove real transport invalidation.

Live host visual/interaction validation is **unverified**: no installation/reload or isolated environment is authorized in this lane. Light/dark/non-default themes, narrow split/coarse-pointer appearance, actual host header/navigation, focus behavior across host lifecycle, close/reopen and reconnect integration remain acceptance gaps. SDK/jsdom tests and bundle builds do not certify those boundaries. A later bounded check should load one generated fixture in an explicitly authorized test host and exercise the [UI review matrix](../docs/dev/ui-ux.md#ui-review-and-verification); product adoption stays deferred until its owner reviews it.
