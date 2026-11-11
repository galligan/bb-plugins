# Runtime and feature support boundary

Matt directed Bots to handle what it can inside the plugin, without asking maintainers to change BB or waiting for upstream agreement/releases. This supersedes the earlier global native-admission gate. BOTS-18 is deferred/non-blocking; its isolated prototype and fork draft remain reference artifacts and must not be merged/deployed under this scope.

## Package compatibility

The initial headless skeleton uses the already published public SDK **0.6.132**, matching the repository and installed-runtime capability probes. Its manifest declares **BB >=0.49.0** and **runtime SDK >=0.6.132**. The exact build dependency is the repository pin, 0.6.138. These minima support the implemented CLI/RPC skeleton, not every planned provider/continuity feature. Proposed SDK 0.6.139 is neither required nor asserted released. No custom BB build or production installation is the default solution.

| Boundary              | Enforcement or consequence                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build dependency      | Exact SDK declarations/tooling; installing it does not upgrade BB.                                                                                  |
| `engines.bb`          | Existing managed install/update and load checks against the running app.                                                                            |
| `engines.bbPluginSdk` | Existing host SDK check, separate from the dependency pin.                                                                                          |
| Development binaries  | BB 0.0.0 skips the app gate; unparseable app versions can skip it with a warning. SDK checking remains. A version string is not source attestation. |
| Planned features      | Enable only implemented/verified paths; surface an unavailable action instead of implying engine compatibility guarantees it.                       |
| Persisted data        | Plugin engine fields do not constrain older core database readers. Do not infer safe rollback from a manifest alone.                                |

The earlier 143 compatibility tests establish the existing manifest/install/load/update mechanisms, not end-to-end Bots support. Production release still needs feature acceptance, reviewed code and green CI. No production activation is performed by building or merging the package.

## Chosen behavior

Native per-thread Stop controls that thread. Bots will not restart a canceled assignment from idle, failed events, reload or maintenance. A persistent per-bot maintenance toggle will govern Bots-owned summary/dream work; it is not a bot-wide pause or control over other plugins. This skeleton registers no background/model work. Automated transitions, dreaming and fallback stay disabled until their own bounded policy and recovery tests pass. Supported explicit recovery can ship while an automatic path is unavailable, with its limitation visible.

Existing native Compact may bypass message admission and report incomplete caller attribution. Bots therefore does not claim a veto over Auto Compact, provider-retry or other installed plugins. Do not disable/reconfigure those plugins, use internal imports, or make control over them a prerequisite for independent plugin work. Preserve durable capture/checkpoints and verified pickup as implementation goals for both main and workers; do not equate an API acceptance with recovery.

## Soul and execution configuration

BOTS-7 uses existing public synchronous configuration and native spawn execution fields. The callback can run for an existing provider session and has no session identity/application receipt. Persist current SOUL and last supplied revision separately; applied revision is unknown, even if both match. No automatic clear, compact, turn or refresh is triggered by an edit. Saved execution defaults affect future construction only; existing conversations keep native controls. Provider availability is checked at native creation, worker null inherits main, and automatic fallback remains disabled. UI pickers and verified refresh/continuity retain their owning feature gates.

## Deferred prototype and rollback caveat

The separate [core fork draft](https://github.com/galligan/bb/pull/3) at `56024d263` changes durable compact-first queue semantics. It is not a Bots dependency, upstream submission or supported release. Keep it and its evidence intact; no further upstream pings, merge or deployment under this direction.

The [baseline reader check](continuity-matrix.md#concrete-queue-compatibility-result) remains valid for that prototype: plugin engine gates cannot protect an older core opening its post-upgrade rows. If that experiment is ever separately released, snapshot before the changed core first starts, preserve post-upgrade state separately, and restore only a consistent pre-upgrade snapshot with matching binaries/plugins, external homes and provider-native session state. A BB database copy alone is not a verified provider-session backup. Never relabel/drop rows or dispatch canceled work to make rollback appear safe. No production restore is authorized or tested. This experimental-core caveat does not impose an unreleased-runtime requirement on the plugin skeleton.
