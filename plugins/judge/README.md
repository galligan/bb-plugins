# Judge

Judge is a headless-first experimental BB plugin for typed judgments over application state, reusable question sets, and optional event-driven verdicts.

**Status: explicit ad hoc CLI/RPC asks are implemented and verified offline.** The backend registers native BB connection fields, model management, privacy enforcement, bounded transports, and transactional run records. Saved sets, sources, triggers, and custom UI follow in later stages. Live provider support remains unverified; Judge remains outside the repository install collection.

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

## Transport implementation

The offline Jev/System One and Workers AI Clef/Clef-flash adapters now validate complete typed batches, retain the returned provider model, bound UTF-8 request/response bytes, disable redirects/retries, and share caller/disposal/budget cancellation. Compatible custom endpoints use the same contract with optional auth. See [transport evidence and primary references](docs/TRANSPORTS.md). Fixture success does not establish live provider or arbitrary local-server compatibility. Workers AI uses separate documented routes/windows for each selector and validates its success/error envelope even on HTTP 200. Judge applies conservative 48 KiB (Clef) and 16 KiB (Clef-flash) request caps; provider token packing/truncation behavior remains a live limitation. Explicit CLI/RPC asks now use these adapters; tests do not make paid calls.

## Connection setup and privacy

Development installs expose **Settings → Installed plugins → Judge [Experimental] → the settings button**. The live BB 0.49.0 form was verified with dummy data: secret inputs show `[set]` after save/reload and `[not set]` after native unset, without reading stored values. Leaving a secret field blank preserves its value; remove it with BB's native `bb plugin config judge unset <setting-key>` command. The fields are Jev / TypeSafe API key, Cloudflare account ID and Workers AI token, and a custom System One URL with optional key. Keys use BB-native secret descriptors; BB owns server-side mode-0600 secret files. This does not guarantee OS-keychain storage or encryption. Saving a key never starts inference. The dedicated Jev checkpoint follows independent approval of this offline ask flow; enter real credentials only through the BB form when that checkpoint is announced.

There is no implicit default model. The shared model service supports add/update/remove, an explicit global default and a private default, and sanitized configured/missing readiness. Readiness checks report configured/missing without network access; `models check --probe` explicitly makes a tiny synthetic public request to test connectivity/authentication/model support. A custom URL must use HTTP(S) without credentials, query, or fragment; it may be an API root or end in `/v1/systemone`. A localhost address targets the BB server machine.

Selection is call override → step → set → global. All models initially disallow private input. Sensitive requests can fall back once to an explicitly selected private default that itself allows private input. Otherwise they stop before cache/transport access. Ad hoc `not-private` disclosure cannot downgrade a source or caller overrides of source values.

Model/default/connection changes invalidate cached inference and local calibration acceptance. Opaque connection revisions never contain or hash keys. Because the public SDK exposes no credential revision, plugin reload conservatively invalidates cache and calibration too; models/defaults and BB-owned credentials remain stored, but calibration must be accepted again after reload. Invalidation hooks let later runners abort stale work. No provider request or live support is implied by configured readiness.

## Explicit commands and RPC

After installing/reloading this development build, start with `bb judge --help`. Every command/group supports `--help`. All leaf commands declare `--json`: success prints the result directly; argument/operational failures exit 1 and print `{ok:false,error:{code,message,hint}}`. Typed unavailable verdicts exit 0 with `complete:false`; callers must inspect the step status. Plain output is readable JSON.

```sh
bb judge models add jev --connection typesafe --model jev-1.13.0 --json
bb judge models default jev --json
bb judge models check jev --json
bb judge ask --model jev --noul 'Is publicSynthetic true?' --state '{"publicSynthetic":true}' --not-private --json
bb judge log -n 20 --json
```

The first three commands never dispatch inference. `typesafe` uses the Jev / TypeSafe BB secret field; `cloudflare` accepts `clef` or `clef-flash`; `custom` uses the configured System One URL. The pinned selector `jev-1.13.0` is documented by TypeSafe and awaits credentialed verification at the dedicated checkpoint; configuring a selector is never evidence of live support. See [live verification evidence](docs/LIVE-VERIFICATION.md). Model add updates an existing ID and defaults `allowPrivate` to false. To explicitly allow sensitive input, save the model with `--allow-private`; `models default <id> --private` chooses the single private fallback. Model/default edits invalidate existing cache/calibration.

Ad hoc state is private unless that individual ask declares `--not-private`. This flag changes no stored policy and is unavailable on management commands. Without an allowed private model/fallback, the ask records a typed refusal before dispatch. The CLI can submit all three primitives using `--questions '<JSON question map>'` instead of `--noul`; exactly one is required. There are no file reads or implicit BB source reads in these commands. The caller's thread/project IDs, when available, associate the run without collecting their state.

`models check <id> --probe` explicitly sends one tiny synthetic public request and may incur charges. It returns sanitized diagnostics; readiness without `--probe`, saving settings, startup and reload never trigger a paid call. A probe is diagnostic and does not create an ask verdict.

RPC methods are `ask`, `models.list`, `models.add`, `models.default`, `models.check`, `log`, and `runs.get`. Inputs and outputs use strict runtime schemas and the same services as the CLI. `ask` accepts `{state,questions,model?,notPrivate?,threadId?,projectId?}`. `models.check` accepts `{id,probe?}`. Management accepts no credentials; use the BB settings GUI. CLI disconnect, RPC disconnect and plugin disposal propagate cancellation to transports. Expected provider failures produce typed unavailable steps; malformed definitions/arguments are validation errors. Persistence failure returns an operational error without a successful logged verdict.

`models list` accepts `--limit 1..100` and `--after <next-id>`. `log` accepts `--set`, `--thread`, `-n/--limit 1..100`, and `--before '<next cursor JSON>'`; equal-timestamp records use run ID as a tie-breaker. Log pages return bounded summaries without reading step answers. `runs.get` RPC `{id}` returns a single complete stored verdict or null. Ad hoc verdicts retain the requested/resolved model identities and actual returned `providerModel`, with no invented saved-set identity, no calibration claim and no request state/credentials in storage. Answers themselves may be sensitive.
