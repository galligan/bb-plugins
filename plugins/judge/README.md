# Judge

Judge is a planned headless-first BB plugin for typed judgments over application state, reusable question sets, and optional event-driven verdicts.

**Status: connection settings and model/privacy foundation; inference surfaces are still in development.** The backend registers native BB connection fields and opens its plugin-owned SQLite repository. Offline modules validate typed requests, provider batches, models, and verdicts. CLI/RPC asks, sources, triggers, custom UI, and provider calls are not registered yet. Judge remains outside the repository install collection.

Validation covers noul probabilities, choice distributions, fractional expected scores with their submitted rubric, structured JSON instructions, nullable input-token usage, and distinct ad hoc/saved-set identities. JSON must be finite and lossless, with depth 16, up to 64 questions/named inputs, 64 KiB per input, 256 KiB per complete request, and 1 MiB per provider response. The fixed verdict envelope permits two extra nesting levels so accepted structured provider answers can round-trip through storage. Dynamic schema maps explicitly reject reserved `__proto__` keys; arbitrary state and structured instruction objects preserve their JSON keys. Definitions and step execution arrive in later stages. Models default to disallowing private input; secret values and request state have no repository fields. Direct answers can be sensitive and remain in bounded run records, not thread metadata.

Run history is capped at 30 days and 10,000 entries, pruned during successful writes with dependent step rows. Stored steps retain execution order independently of their IDs. History reads return at most 100 records and use timestamp/ID cursors to preserve entries sharing a timestamp. Persistence failure is an operational error; callers must not publish actions when a run cannot be recorded.

## Build briefing

- [Implementation spec](docs/SPEC.md) is the current contract and supersedes the original proposal where they differ.
- [BB compatibility review](docs/COMPATIBILITY.md) records verified contracts, corrections, evidence, and remaining checks.
- [Task board map](docs/TASKS.md) links the BBP parent and all implementation tasks, including the Jev key checkpoint.
- [Implementation plan](docs/IMPLEMENTATION.md) divides the work into independently verifiable stages.
- [Original proposal](docs/original-proposal.txt) preserves the supplied text unchanged for provenance, not as implementation authority.

## Development

Use the repository's pinned Bun 1.3.14. Install dependencies once at the repository root with `bun install`. From this directory, run `bun run check` and `bun run build`. Builds use the package-local `bb-app@0.49.0` toolchain and public `@get-bb/plugin-sdk@0.6.132` declarations. No generated declarations or `dist/` files are committed. `skipLibCheck` skips dependency declaration internals; plugin source remains strictly checked.

Before pushing, run the root formatting, lint, check, test, and build commands documented in [CONTRIBUTING.md](../../CONTRIBUTING.md). `bun run test` runs the deterministic Node suite; storage tests use the public SDK fake host with its real SQLite peer. No inference requests run in tests. The package also checks that its imports use the public SDK surface.

## Connection setup and privacy

Development installs expose **Settings → Installed plugins → Judge [Experimental] → the settings button**. The live BB 0.49.0 form was verified with dummy data: secret inputs show `[set]` after save/reload and `[not set]` after native unset, without reading stored values. Leaving a secret field blank preserves its value; remove it with BB's native `bb plugin config judge unset <setting-key>` command. The fields are Jev / TypeSafe API key, Cloudflare account ID and Workers AI token, and a custom System One URL with optional key. Keys use BB-native secret descriptors; BB owns server-side mode-0600 secret files. This does not guarantee OS-keychain storage or encryption. Saving a key never starts inference. The dedicated Jev checkpoint follows the usable ask flow; no real key is needed at this stage.

There is no implicit default model. The shared model service supports add/update/remove, an explicit global default and a private default, and sanitized configured/missing readiness. Connectivity/authentication/model support remain untested until an explicit provider check exists. A custom URL must use HTTP(S) without credentials, query, or fragment; it may be an API root or end in `/v1/systemone`. A localhost address targets the BB server machine.

Selection is call override → step → set → global. All models initially disallow private input. Sensitive requests can fall back once to an explicitly selected private default that itself allows private input. Otherwise they stop before cache/transport access. Ad hoc `not-private` disclosure cannot downgrade a source or caller overrides of source values.

Model/default/connection changes invalidate cached inference and local calibration acceptance. Opaque connection revisions never contain or hash keys. Because the public SDK exposes no credential revision, plugin reload conservatively invalidates cache and calibration too; models/defaults and BB-owned credentials remain stored, but calibration must be accepted again after reload. Invalidation hooks let later runners abort stale work. No provider request or live support is implied by configured readiness.

Do not use this development build to evaluate inference yet. The first usable milestone is an explicit CLI/RPC request to a configured model with privacy enforcement, bounded requests, and deterministic transport tests.
