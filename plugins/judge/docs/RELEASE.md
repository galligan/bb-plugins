# Judge distribution preparation

**Preparation only; full release remains gated.** Package `bb-plugin-judge`, plugin ID `judge`, version `0.1.0`, BB floor `>=0.49.0`, public SDK floor `>=0.6.132`. The development toolchain pins `bb-app@0.49.0` and `@get-bb/plugin-sdk@0.6.132`; repository validation uses Bun1.3.14 and Node24.22.2. `private:true` stays in place and Judge stays outside `.bb/plugins.json` until the agreed live/delivery gates are met. No npm/Git release, tag or marketplace publication has been performed.

## Independent source and production builds

Two separate copies of the reviewed `588800958624cf73a75cd146f713261f110c6135` source were created outside the Git/Bun workspace, containing only the plugin's tracked files. Neither inherited an ancestor workspace or private package dependency. The package dependencies use public version selectors, with no `workspace:`, `file:` or `link:` dependency. One copy installed development dependencies with lifecycle scripts disabled, then passed TypeScript and build. A second used the same production-only dependency flags as BB's documented Git install and built with no installed SDK development package:

```sh
# In a standalone copy of plugins/judge, with Bun1.3.14 and Node24.22.2:
bun install --ignore-scripts
bun run check
bun run build

# In a different clean copy; BB0.49.0 CLI available:
npm install --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
bb plugin build .
```

Both builds emitted server/app bundles, CSS and artifact metadata for `judge@0.1.0`, SDK0.6.132 and artifact format1, built with BB0.49.0. Server/app/CSS hashes matched between the two standalone builds. Their server bundle matches the live-verification server hash. These checks prove dependency installation and artifact generation, not a fresh managed registration or uninstall/reinstall cycle. The active Judge registration and credentials were untouched. The finalized package-file-list and documentation were subsequently copied into both build copies and rechecked; final evidence is attached to BBP-24.

An npm dry run initially omitted `dist/` because `.gitignore` excluded it. The explicit `files` list now includes built artifacts plus declared source entries, local modules/registry support, skill, docs and build configuration. The MIT license is supplied inside the independent package. The repeated `npm pack --dry-run --json` check verifies required entry/artifact/skill/license files and excludes dependency trees and Git metadata. This is a content inspection, not publication; generated `dist/` stays uncommitted and a build must precede packing. The package still contains its source tests for reproducible developer verification.

## Reproducible source installation

For an authorized development install, use the exact reviewed commit that contains this preparation rather than assuming `main` contains the unmerged upper stack:

```sh
git clone https://github.com/galligan/bb-plugins.git
cd bb-plugins
git checkout <reviewed-commit>
bun install --frozen-lockfile
bun run --cwd plugins/judge build
bb plugin install ./plugins/judge
```

The caller reviews BB's resolved source confirmation. Installation runs full-trust plugin code. No credential belongs in this checkout or command line. Enter credentials through Settings → Installed plugins → Judge [Experimental] → settings. Startup, credential saving and readiness do not dispatch inference. A local-path install uses that source directory; leave it in place. BB can preserve a source installed from a managed/temporary workspace, so use the resolved path BB reports rather than assuming the original directory is permanent.

A direct Git source can select a package without a collection entry:

```sh
bb plugin install git:https://github.com/galligan/bb-plugins.git@<reviewed-commit> --subdirectory plugins/judge
```

This instruction describes BB's supported source syntax. A fresh managed Git activation was not performed in this checkpoint. Do not use `--plugin judge` until the collection actually contains Judge, do not substitute `@main` while these branches remain unmerged, and do not infer npm publication from a successful dry run. The task/PR delivery supplies the exact reviewed commit; placeholders above are intentional and must be replaced.

## Disable, update and removal

For a reversible pause, use:

```sh
bb plugin disable judge
```

BB unloads Judge's services, listeners, UI and agent contributions. Judge aborts in-flight operations; no queue is resumed. Native settings/secrets and plugin data remain stored while disabled. Re-enable with `bb plugin enable judge`; configuration must still pass current readiness/policy checks, and reload/restart conservatively retires cache/calibration. Enabling the plugin or agent selection does not itself run inference. Keep bindings disabled until explicit live operation is intended.

For a local development rollback, disable Judge, return its dedicated source checkout to an approved commit through the repository's coordinated Git workflow, rebuild, then re-enable or reload Judge alone. Preserve uncommitted work first; never reset an occupied shared checkout. For managed sources, use BB's source/update workflow and retain the previous resolved source details. A failed managed update's rollback is BB-owned behavior, not a substitute for this plugin's own migration/data testing.

**Removal deletes configuration and credentials.** `bb plugin remove judge` explicitly deletes BB-native settings, secret files and schedules for the registration. BB's implementation intentionally keeps plugin KV/database data across a remove/reinstall cycle; local path source directories are retained, while managed artifacts follow BB's cleanup policy. Judge's SQLite model/set/run records can therefore survive while their BB-native connection secrets do not. Reinstalling the same ID is not a blank database or a ready connection. Re-enter credentials directly in the BB form and verify sanitized readiness; do not restore a secret by asking an agent to read it.

These expectations were checked read-only against BB0.49.0 CLI removal help and `plugin-service.ts` at inspected BB source HEAD `a124a8d4f211ae101ceb6f09e99ebaee9cadc011` (including its explicit KV/database preservation comment). Actual uninstall/reinstall was deliberately not exercised against the user's configured Jev instance. Disposal/reload cancellation was exercised separately in [live verification](LIVE-VERIFICATION.md). No key file was opened or copied.

## Delivery and remaining gates

| Stage                | Disposition                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BBP-6 through BBP-19 | Independently reviewed and merged: PR13,16,20,21,22,26,29,37,41,49,51,53,56,58. Historical failed reviews and their fixed-head approvals are retained on the tasks. |
| BBP-20               | Reviewed event/publication implementation, PR79 remains unmerged.                                                                                                   |
| BBP-21 and BBP-22    | Reviewed UI/agent implementation, PR80/86 remain draft/unmerged; later live limits remain explicit.                                                                 |
| BBP-23               | Reviewed scoped evidence delivery, PR99 remains draft/unmerged. Full provider/platform/host acceptance remains open.                                                |
| BBP-24               | Independent build/content/lifecycle documentation preparation. Full distribution/collection readiness remains gated.                                                |

The [live matrix](LIVE-VERIFICATION.md) names the outstanding Cloudflare, actual custom endpoint, native agent invocation, separate sidebar/failure-event, remote/sleeping-host and secret-rotation scenarios. The user's current UI/host-scope follow-up also holds merge/publication. Those dispositions are not fabricated passes. Remove the private marker and add a verified collection/index entry only after the agreed gates are satisfied; publish only with explicit authorization. Parent BBP-5 is not complete while required child acceptance or delivery gates remain open.
