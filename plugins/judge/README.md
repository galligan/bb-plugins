# Judge

Judge is a headless-first experimental BB plugin for typed judgments over application state, reusable question sets, and optional event-driven verdicts.

**Status: ad hoc and saved-set CLI/RPC asks are implemented and verified offline.** The backend registers native BB connection fields, model management, privacy enforcement, bounded transports, and transactional run records. Global question sets support sequential execution with lazy gates, whole-run budgets, project filters and source provenance. Three inert templates include authored cases and copy provenance. Explicit case evaluation/comparison and separate calibration acceptance now share those services. Bounded thread/event/Git source modules are verified offline; public Git contracts also passed read-only checks on the implementation environment. A bounded whole-request cache now serves ordinary asks after fresh privacy/configuration checks; triggers and custom UI follow in later stages. A tiny credentialed public Jev smoke succeeded; live case quality, Workers AI/custom and later workflows remain unverified. Judge remains outside the repository install collection.

Validation covers noul probabilities, choice distributions, fractional expected scores with their submitted rubric, structured JSON instructions, nullable input-token usage, and distinct ad hoc/saved-set identities. JSON must be finite and lossless, with depth 16, up to 64 questions/named inputs, 64 KiB per input, 256 KiB per complete request, and 1 MiB per provider response. The fixed verdict envelope permits two extra nesting levels so accepted structured provider answers can round-trip through storage. Dynamic schema maps explicitly reject reserved `__proto__` keys; arbitrary state and structured instruction objects preserve their JSON keys. Models default to disallowing private input; secret values and request state have no repository fields. Direct answers can be sensitive and remain in bounded run records, not thread metadata.

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

Development installs expose **Settings → Installed plugins → Judge [Experimental] → the settings button**. The live BB 0.49.0 form was verified with dummy data: secret inputs show `[set]` after save/reload and `[not set]` after native unset, without reading stored values. Leaving a secret field blank preserves its value; remove it with BB's native `bb plugin config judge unset <setting-key>` command. The fields are Jev / TypeSafe API key, Cloudflare account ID and Workers AI token, and a custom System One URL with optional key. Keys use BB-native secret descriptors; BB owns server-side mode-0600 secret files. This does not guarantee OS-keychain storage or encryption. Saving a key never starts inference. The Jev checkpoint verified one tiny public request after user GUI entry; all credential entry remains through the BB form.

There is no implicit default model. The shared model service supports add/update/remove, an explicit global default and a private default, and sanitized configured/missing readiness. Readiness checks report configured/missing without network access; `models check --probe` explicitly makes a tiny synthetic public request to test connectivity/authentication/model support. A custom URL must use HTTP(S) without credentials, query, or fragment; it may be an API root or end in `/v1/systemone`. A localhost address targets the BB server machine.

Selection is call override → step → set → global. All models initially disallow private input. Sensitive requests can fall back once to an explicitly selected private default that itself allows private input. Otherwise they stop before cache/transport access. Ad hoc `not-private` disclosure cannot downgrade a source or caller overrides of source values.

Model/default/connection changes invalidate cached inference and local calibration acceptance. Opaque connection revisions never contain or hash keys. Because the public SDK exposes no credential revision, plugin reload conservatively invalidates cache and calibration too; models/defaults and BB-owned credentials remain stored, but calibration must be accepted again after reload. Invalidation hooks abort stale in-flight runs. No provider request or live support is implied by configured readiness.

## Explicit commands and RPC

After installing/reloading this development build, start with `bb judge --help`. Every command/group supports `--help`. All leaf commands declare `--json`: success prints the result directly; argument/operational failures exit 1 and print `{ok:false,error:{code,message,hint}}`. Typed unavailable verdicts exit 0 with `complete:false`; callers must inspect the step status. Plain output is readable JSON.

```sh
bb judge models add jev --connection typesafe --model jev-1.13.0 --json
bb judge models default jev --json
bb judge models check jev --json
bb judge ask --model jev --noul 'Is publicSynthetic true?' --state '{"publicSynthetic":true}' --not-private --json
bb judge log -n 20 --json
```

The first three commands never dispatch inference. `typesafe` uses the Jev / TypeSafe BB secret field; `cloudflare` accepts `clef` or `clef-flash`; `custom` uses the configured System One URL. The pinned selector `jev-1.13.0` is documented by TypeSafe and passed one tiny credentialed public smoke at the dedicated checkpoint; configuring other selectors is never evidence of live support. See [live verification evidence](docs/LIVE-VERIFICATION.md). Model add updates an existing ID and defaults `allowPrivate` to false. To explicitly allow sensitive input, save the model with `--allow-private`; `models default <id> --private` chooses the single private fallback. Model/default edits invalidate existing cache/calibration.

Ad hoc state is private unless that individual ask declares `--not-private`. This flag changes no stored policy and is unavailable on management commands. Without an allowed private model/fallback, the ask records a typed refusal before dispatch. The CLI can submit all three primitives using `--questions '<JSON question map>'` instead of `--noul`; exactly one is required. There are no file reads or implicit BB source reads in these commands. The caller's thread/project IDs, when available, associate the run without collecting their state.

`models check <id> --probe` explicitly sends one tiny synthetic public request and may incur charges. It returns sanitized diagnostics; readiness without `--probe`, saving settings, startup and reload never trigger a paid call. A probe is diagnostic and does not create an ask verdict.

RPC methods are `ask`, `models.list`, `models.add`, `models.default`, `models.check`, `log`, and `runs.get`. Inputs and outputs use strict runtime schemas and the same services as the CLI. `ask` accepts `{state,questions,model?,notPrivate?,threadId?,projectId?}`. `models.check` accepts `{id,probe?}`. Management accepts no credentials; use the BB settings GUI. CLI disconnect, RPC disconnect and plugin disposal propagate cancellation to transports. Expected provider failures produce typed unavailable steps; malformed definitions/arguments are validation errors. Persistence failure returns an operational error without a successful logged verdict.

`models list` accepts `--limit 1..100` and `--after <next-id>`. `log` accepts `--set`, `--thread`, `-n/--limit 1..100`, and `--before '<next cursor JSON>'`; equal-timestamp records use run ID as a tie-breaker. Log pages return bounded summaries without reading step answers. `runs.get` RPC `{id}` returns a single complete stored verdict or null. Ad hoc verdicts retain the requested/resolved model identities and actual returned `providerModel`, with no invented saved-set identity, no calibration claim and no request state/credentials in storage. Answers themselves may be sensitive.

## Global question-set definitions

`bb judge questions list|show|save|import|export|remove` manages version1 YAML definitions. `save` is an alias for file import; saving an existing ID replaces the global definition, invalidates inference/calibration and disables its dependent triggers. Neither import nor any other management command runs inference. `projects set <project-id> --enabled true|false` sets the project switch; the unconfigured default is on. Project-switch edits conservatively invalidate inference/calibration and disable all triggers. Trigger activation itself is a later explicit stage.

```sh
bb judge questions import --file ./definition.yaml --json
bb judge questions import --file /remote/repo/definition.yaml --machine <host-id> --json
bb judge questions list --project <project-id> --limit 20 --json
bb judge questions show <set-id> --json
bb judge questions export <set-id> > definition.yaml
bb judge questions remove <set-id> --json
```

File import uses the calling thread → environment → connected host and `bb.sdk.files`. Without a calling thread, use `--machine <host-id-or-name>` and an absolute host path. A machine override also requires an absolute path. No caller file is opened with server `node:fs`, no host is woken, and there is no server-host fallback. YAML must be UTF-8 and at most256KiB. Export writes normalized YAML to stdout; `--json` wraps it as `{yaml}`. All commands support help/JSON errors; list pages cap at100 and continue via `--after <next-id>`.

See [question-set formats and validation](docs/QUESTION-SETS.md). Shorthand normalizes to step `main`, canonical JSON determines the hash, and export/import preserves it. Definitions reject duplicate YAML keys, aliases/anchors/custom tags, unknown fields, non-JSON values, mixed forms, invalid references and predicate ranges. Cases are authored fixtures stored with the definition; source runtime state is never captured. Lists expose every global definition with an applicability flag, rather than hiding definitions from other projects. The project switch and set filters gate the saved-set runner; management remains available when execution is inapplicable.

RPC management methods are `sets.list`, `sets.show`, `sets.save`, `sets.import`, `sets.export`, `sets.remove`, and `projects.set`, with the same services and strict input/output validation. RPC save/import accept inline `{yaml}`; file routing belongs to the CLI. No YAML field can grant private-data permission or select arbitrary cross-plugin actions.

## Bounded thread, event and Git sources

The source modules project thread titles, assistant replies, observed command evidence/output, user-origin request text, current goal events, project names, provider configuration, and allowlisted event fields. They share deadlines/cancellation and return explicit unavailable or too-large results. Saved-set asks collect declared sources lazily; source adapters themselves make no provider requests.

An idle event with null assistant text remains absent evidence; it never falls back to an older reply. A latest goal-cleared event similarly prevents stale objective reuse. Command output retains upstream truncation metadata. Command evidence records what was observed at its sequence/time; it does not establish that checks cover the latest edits.

The pinned thread prompt-history method has no per-entry origin or cursor. Recent user messages therefore use descending, origin-tagged request events, excluding plugin/system/agent/cross-thread/retry entries and hidden content. Ambiguous grouped or unsupported nontext content returns unavailable. See [source contracts and compatibility evidence](docs/SOURCES.md), including the scope of the verified event projection and its remaining live-provider/history limits.

Git status, changed files and diff use only public `bb--git` RPC against an explicitly supplied environment, with no host wake or fallback checkout. Select `target: uncommitted`, or `target: branch` plus a required `base` for committed branch changes. Paths/diffs remain sensitive; per-file revisions, truncation, incomplete line statistics and observation provenance survive projection. Oversized evidence is refused whole. A real environment passed all six method/target combinations, retaining only sanitized keys/counts/lengths/hashes as verification evidence. Live sleeping/remote hosts and source-to-runner inference remain later gates.

## Saved-set asks

Run `bb judge ask <set-id> [--thread <thread-id>] [--model <model-id>] --json`, or RPC `run` with `{id,threadId?,projectId?,model?,inputs?}`. The runner validates the thread/project/environment association, applies project filters, then executes steps in order. Gate-false steps read nothing; unavailable steps stop the run and leave final outcomes empty. Model selection and private fallback apply per step. One deadline covers source reads and requests; disconnect, disposal and configuration edits abort work. Verdicts persist before successful return and remain uncalibrated until explicit evaluation acceptance exists.

RPC supports partial source overrides keyed by step/input. They are always sensitive and cannot downgrade private-data policy. `--not-private` applies only to ad hoc state and is rejected for saved sets. See [runner behavior, privacy and verification](docs/RUNNER.md). No live saved-set inference, calibration or trigger action is implied by the offline runner tests.

## Inert templates

`bb judge templates list --json` lists `needs-attention`, `completion-check` and `diff-lint`. Copy one with `bb judge templates use <template-id> --id <new-set-id> --json`, then inspect/edit/export it through question management. RPC methods are `templates.list` and `templates.use`. Copies require a new ID, preserve `<template>@<version>` origin, and remain independent editable definitions without calibration acceptance or enabled triggers. Copy/list never invokes inference or changes private-data policy.

Each template includes positive, negative, absent and ambiguous synthetic cases. Completion-check flags missing observed verification and makes no claim of current correctness or up-to-date checks. Diff-lint uses fixed yes-means-violation questions against an explicitly bounded diff. Thresholds are uncalibrated examples. Recorded offline case tests prove normalization/gates/outcome wiring with no live source calls; fixtures remain sensitive. See [template contracts and case limits](docs/TEMPLATES.md).

## Case evaluation and acceptance

`bb judge test <set-id> [--model <primary-id>] [--compare <second-id>] --json` explicitly evaluates authored cases and can incur provider charges. Cases bypass live sources but retain private-data policy. Reports distinguish correct, incorrect and unavailable cases, per-outcome rates, step counts and actual resolved identities/fallbacks; comparison lists disagreements and chooses no winner. One evaluation runs at a time under a30-second execution budget. Sanitized reports persist separately from case runs and contain no state, raw answers or keys.

After reviewing a complete current report, use `bb judge calibration accept <set-id> --run <evaluation-report-id> --json`. It accepts only the primary variant's actual fingerprints, never a declaration or automatic winner. Partial/stale/subset reports are refused; explicit acceptance may acknowledge known mismatches and does not certify perfect accuracy. Saved verdicts become calibrated only when every executed model fingerprint matches accepted evidence for the current set hash. Edits, connection changes and reload invalidate acceptance; reload requires fresh evaluation. Reports retain30days/1,000entries on writes and expired evidence retires acceptance.

RPC methods are `test`, `tests.get`, `calibration.accept` and `calibration.get`. They share CLI services and strict bounded schemas. See [evaluation/report/acceptance behavior](docs/EVALUATION.md), including provider-label limits, cancellation, retention and the distinction between offline mechanism tests and live judgment quality. No new live provider evaluation is claimed here.

## Response reuse and retention

Ordinary asks reuse complete validated whole-request responses for at most 60 seconds, capped at 1,000 entries. Actual model/configuration revisions and canonical full question-map/state hashes determine identity; privacy is checked before lookup. Hits still write fresh run records and re-evaluate outcomes, with `cacheHit:true`, current attribution/provenance and zero newly sent input tokens. State and credentials are absent from cache rows; typed answers can remain sensitive. Evaluation and connectivity probes bypass the cache and always make fresh explicit requests. See [cache and run-retention behavior](docs/CACHE.md), including invalidation, clock boundaries, corrupt-entry refusal and transactional cleanup. No live request was needed for offline verification.
