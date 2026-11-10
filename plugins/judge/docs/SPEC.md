# Judge implementation spec

Status: ready for staged implementation; runtime is not implemented. Baseline: BB 0.49.0 / public SDK 0.6.132. This document supersedes conflicting details in [the original proposal](original-proposal.txt). See [compatibility evidence](COMPATIBILITY.md) and [delivery gates](IMPLEMENTATION.md).

## Goal and scope

Provide one plugin-owned connection layer for typed decision questions over arbitrary JSON or bounded BB state. Users and plugins can ask directly, save multi-step question sets, and opt into best-effort event-driven verdicts. Inference supplies judgments; ordinary code owns validation, privacy, gates, and action eligibility.

The spike includes System One and Workers AI transports, explicit model selection, sources, global saved sets, three example templates, calibration runs, and record/badge triggers. It excludes messages to agents, arbitrary RPC actions, dispatch hooks, tool approval, notification delivery, images, project-committed definitions, computed choices, fan-out, and passing earlier answers as later state. An optional read-only agent tool and authoring skill follow the usable CLI; they do not require send/RPC actions.

## Package and modules

Package `bb-plugin-judge`, plugin ID `judge`, directory `plugins/judge`. Keep `server.ts` as registration wiring. Add focused modules when their stage lands: `lib/contracts.ts`, `lib/transports/`, `lib/models.ts`, `lib/privacy.ts`, `lib/storage.ts`, `lib/sources/`, `lib/runner.ts`, `lib/outcomes.ts`, `lib/cli.ts`, `lib/triggers.ts`, and `templates/`. Introduce `app.tsx` with verdict UI. These are responsibility boundaries, not a requirement to create empty files now.

Use the public SDK only. No dependency on plugin-studio or BB internals. Runtime validators and YAML parsing belong in package dependencies; SDK/build/type tooling belongs in devDependencies. Prefer a small strict schema over an extensible workflow engine.

## Connections and models

Fixed connection types:

- `typesafe`: secret `typesafeApiKey`; endpoint `https://api.typesafe.ai/v1/systemone`.
- `cloudflare`: `cloudflareAccountId`, secret `cloudflareApiToken`; Workers AI endpoint selected from `clef` or `clef-flash`.
- `custom`: configured API root `customBaseUrl`, optional secret `customApiKey`; append `/v1/systemone` exactly once. Require an explicit reachable HTTP(S) endpoint; reject embedded credentials, query, and fragment. Disable redirects to avoid forwarding credentials or private data to another destination. Local addresses refer to the BB server machine.

A model record contains `id`, `connection`, provider `model`, `allowPrivate` (default false), and limits validated for that endpoint. A changed connection or model configuration changes its fingerprint. No keys appear in documents, hashes, logs, metadata, or frontend results. A settings change invalidates affected cache entries.

Resolution: call override → step model → set model → configured global default. There is no implicit working model on installation. A sensitive step may fall back once to `privateDefault`, which must exist and itself allow private input. Otherwise return `private_not_allowed`. Record requested and resolved model identities and fallback reason. Apply the guard before cache access as well as network access.

Use plain fetch for the initial two small adapters. TypeSafe's SDK supports custom URL/fetch and remains a valid future alternative; lack of SDK support is not the reason for this choice. No automatic retries in the spike. Validate the complete provider response against the submitted question IDs, types, allowed options, finite values, ranges, and distributions. Treat an unsuccessful Workers AI envelope as failure even with HTTP 200. Missing usage is `null`, never fabricated zero.

Support the common JSON/text subset: noul probability, choice with probabilities, and fractional expected score with rubric and probabilities. Keep compatible question structures, including structured JSON instructions where supported by both adapters. Reject provider-specific modalities at the boundary until explicitly supported.

### Jev key setup and agent handoff

Implement connection secret descriptors in the first usable milestone, before custom Judge UI. BB renders them in Settings → Installed plugins → Judge. Declare `typesafeApiKey` with `type: "string"`, `secret: true`, and a user-facing label such as “Jev / TypeSafe API key”. BB owns saving and replacement in its server-side secret store (documented as a mode-0600 file); this is not a promise of OS-keychain storage or encryption at rest.

When the descriptor is implemented, the plugin is installed for live validation, and offline ask tests pass, the implementing agent tells the user that key entry is now needed and gives the verified GUI path. Do not request a key in chat, task comments, shell arguments, environment files, or source. The user enters it directly into BB's settings form. The agent checks only a sanitized readiness result, not the stored value or settings-file contents. Missing keys leave inference `not_configured`; they must not block unrelated offline implementation.

Expose connection readiness through the shared model-check service: configured/missing, reachable/authentication-failed/unsupported-model when explicitly tested, and a safe next action. Never return a secret, secret prefix, or raw upstream body. Saving a key must not automatically start paid model calls. After the user stores it, run an explicit tiny synthetic, non-sensitive Jev smoke request; report configured model identity, typed result, and latency. Confirm configured status survives plugin reload without reading the credential. Replacing/removing the key invalidates affected cache entries and immediately changes readiness. Private BB state remains blocked until a model's private-data policy is explicitly configured.

Cloudflare and authenticated custom endpoints use the same secret-setting flow when their credentialed validation is reached. Verify the actual GUI field and masked/readback behavior with dummy data before involving a real key. Keep real-key screenshots and transcripts out of task artifacts.

## Privacy and bounds

All free text, prompts, command text/output, goals, paths/diffs, project names, and ad hoc state default to sensitive. Known provider IDs and identifier-only event facts may be public. Source classification is plugin/user policy; a question set cannot downgrade it. Caller overrides of source values stay sensitive. `ask --not-private` applies only to caller-supplied ad hoc state and is an explicit disclosure choice, not authorization for unrelated source reads.

Initial product limits (not provider guarantees): 64 questions per request, 16 steps per set, 64 named inputs per step, 64 KiB UTF-8 per input, 256 KiB serialized request, 1 MiB response, and 256 KiB definition file. Use lower provider limits when applicable. Reject unknown fields, duplicate YAML keys, custom YAML tags, aliases, and excessive nesting before execution. Limit expression depth to 16. Reject non-JSON values and non-finite numbers.

Every source accepts a bounded `maxChars` selection, plus a hard UTF-8 byte ceiling. Explicit recent-message/command windows are allowed and reported as selection metadata. If the selected content exceeds its cap, return `too_large`; never silently clip evidence. Include question definitions in total size checks. Byte checks are deterministic; token estimates are approximate and cannot promise to fit a provider context window. Normalize a provider context-limit rejection to `too_large`.

No raw state capture in the spike, including debug mode. Log hashes, lengths, source selection metadata, sanitized error codes, and timing. Raw answers remain available to the direct caller and bounded database run records; choice labels and legends can themselves be sensitive. Thread metadata contains only a compact verdict summary, never answers, state, secrets, or raw provider errors.

## Source contract

Each source returns `{ value, sensitive, provenance }` or a typed failure. Provenance records source ID, selection/window, observation time, and available event sequence/revision without copying source text. Resolve only the inputs of steps that actually run.

| Source                                          | Resolution                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `thread.title`                                  | Thread DTO title                                                                                                      |
| `thread.lastAssistantText`                      | Trigger's idle payload when present, otherwise `threads.output`; null is absent, not an empty successful source       |
| `thread.commands`                               | Bounded descending `threads.events.list` over completed command items; expose command, exitCode, durationMs, sequence |
| `thread.commandOutput`                          | Same selection with available output and truncation flag; truncated upstream evidence must be disclosed               |
| `thread.recentUserMessages`                     | Prompt history/timeline projection after the compatibility gate is satisfied                                          |
| `thread.goal`                                   | Latest updated/cleared goal event after the compatibility gate is satisfied                                           |
| `git.changedFiles`, `git.status`, `git.diff`    | Validated public `bb--git` RPC against the thread environment; explicit uncommitted or branch target                  |
| `project.name`, `provider.id`, `provider.model` | Explicit projection from relevant public DTOs; unavailable fields do not become guessed values                        |
| `event.*`                                       | Allowlisted fields of the normalized trigger payload; no arbitrary wildcard serialization                             |

Missing thread/environment, disabled Git plugin, unavailable host, missing evidence, or unsupported provider history returns `source_unavailable` with a bounded diagnostic code. No host wake, shell fallback, or cross-thread inference is implicit.

## Question sets and outcomes

Persist a versioned YAML document (`schemaVersion: 1`, `id`, `description`, optional `model`, `projects`, `budgetMs`, and calibration declarations). Canonical validated JSON, not YAML formatting, determines hashes. Global scope means storage ownership; `projects: all | [projectId]` determines applicability. The project switch gates saved-set execution and triggers, not explicit ad hoc asks. Calls without a project can run only unrestricted sets. Default project switch is on; triggers still start disabled.

Single-step sets use top-level `inputs`, `questions`, and `outcomes`, normalized to step `main`. Multi-step sets use `steps` with unique IDs and top-level final `outcomes`; reject mixing the two forms. Each step has named inputs, questions, outcomes, optional model, and optional `when`. Questions reference named state fields; never interpolate input text into instructions.

Steps run sequentially, one model request each. `when` is an expression over earlier step outcomes only. Within a step, predicates reference that step's questions; named references may target earlier steps. Final outcomes reference step outcomes only. Reject forward references, unknown IDs, cycles, and ambiguous names at import. Do not allow same-step outcome-to-outcome references in v1.

Expression forms are `{ all: [term, ...] }`, `{ any: [term, ...] }`, and `{ not: term }`. Reject empty all/any. Terms are qualified earlier outcomes (`screen.claimed`) or question predicates:

- Noul: `{ q, gte }` or `{ q, lte }`, threshold in `[0, 1]`.
- Choice: `{ q, is, gte }`; the returned choice must equal `is` and its probability must meet the threshold. Do not use distribution confidence as that probability.
- Score: `{ q, gte }` or `{ q, lte }`, against the returned fractional expected score in the submitted rubric's range.

Skipped steps have false outcomes. An unavailable step stops execution; later steps are skipped with reason `upstream_unavailable`, the run is incomplete, and set-level outcomes are empty. Never evaluate `not` over missing evidence into an actionable true result. Later steps receive only their declared inputs, never previous answers.

Default request timeout is 2,000 ms; default whole-set deadline is 5,000 ms, with a 30,000 ms maximum. Source reads, requests, response validation, and evaluation share the run deadline. Each request uses the lesser of its timeout and remaining time. Abort on caller cancellation, disposal, or deadline; clear timers. A request timeout is `timeout`, exhausted run deadline is `budget`, caller/disposal abort is `cancelled`. Do not start work after expiry.

## Calibration and cases

Cases supply input values keyed by step then input name, plus expected final outcomes. Single-step shorthand accepts flat inputs. Cases bypass live sources but retain privacy rules. Deterministic fixture transport tests prove runner mechanics; live model tests measure judgments and cost money. Neither substitutes for the other.

Keep the proposal's `calibratedFor` as a declaration of intended model IDs, but it is insufficient to enable trigger actions. Persist a local calibration acceptance tied to set hash and the resolved model configuration fingerprints. `judge test` reports results; a user explicitly accepts the calibration after reviewing them. Any set/model/connection change invalidates acceptance. Every executed step, including private fallbacks, must match an accepted fingerprint. Hosted mutable aliases cannot establish weight-level pinning; record that limitation and require rechecking when provider changes are known.

Templates are inert copies with origin `<template>@<version>`, required cases, and no inherited calibration acceptance. Initial templates: `needs-attention`, `completion-check` (missing observed check evidence, never proof of correctness), and `diff-lint` (fixed violation questions over the selected diff). Example thresholds require local evaluation before triggers act.

### Example definition

This single-step example normalizes to `main`. It declares an intended model but has no calibration acceptance and cannot activate a trigger by itself.

```yaml
schemaVersion: 1
id: needs-attention
description: Does the latest reply require an answer from the user?
projects: all
budgetMs: 5000
calibratedFor: [jev]
inputs:
  last_message:
    from: thread.lastAssistantText
    maxChars: 12000
questions:
  needs_answer:
    type: noul
    instructions: Does `last_message` ask the user for information required to continue?
outcomes:
  needs_you:
    all:
      - q: needs_answer
        gte: 0.7
cases:
  - inputs:
      last_message: Which database should I target before I can continue?
    expect:
      needs_you: true
  - inputs:
      last_message: The change is complete and its tests passed.
    expect:
      needs_you: false
```

## Results, storage, and cache

`StepResult` is discriminated by `status`:

- `ran`: requested/resolved model identity, raw typed answers, boolean outcomes, latency, nullable input-token usage, cache hit, source provenance.
- `skipped`: reason `gate_false` or `upstream_unavailable`.
- `unavailable`: reason `timeout | error | too_large | budget | private_not_allowed | source_unavailable | not_configured | invalid_response | cancelled`, plus sanitized code.

A set `Verdict` contains run ID, set ID/scope/hash, thread/project context if supplied, start/end time, complete/calibrated flags, step results, and final outcomes. Ad hoc requests have a run ID but no invented saved-set identity. Invalid definitions/arguments are boundary validation errors, not model outages. Model/source failures return typed unavailable results. Persistence failure is surfaced as an operational error and suppresses actions; do not claim a logged verdict when storage failed.

Use plugin SQLite with append-only migrations: `models`, `question_sets`, `triggers`, `runs`, `steps`, `cache`, plus project settings and calibration acceptance. Definitions store validated YAML plus schema version/hash and global scope. The database is authoritative; metadata is a derived display cache. Bound runs to 30 days and 10,000 entries, deleting dependent step rows together. Bound cache to 1,000 entries with a 60-second TTL; prune opportunistically on writes.

Cache complete validated responses by transport/endpoint configuration revision, resolved model fingerprint, canonical full question-map hash, and canonical state hash. Store per-question hashes for diagnostics, but do not split a batch into per-question cache entries until batch equivalence is proven. Re-evaluate privacy before lookup. Cached inference still generates a run record and fresh outcome evaluation; do not cache outages.

## Triggers and display

Support `thread.idle` and `turn.failed` only. Definitions bind one saved set to an event and project filter, with named outcome badges. Effective applicability is the intersection of project switch, set filter, and trigger filter. All new/imported/edited triggers are disabled; enabling is explicit. Changing a referenced set disables affected triggers and invalidates calibration. This prevents accidental activation; BB's client identity does not provide human-vs-agent authorization.

Persist every attempted trigger run. Publish badges only for complete, calibrated, current results. Snapshot set/config hashes and event identity before starting; before publishing, check the thread has not advanced and configuration is unchanged. Limit inference to two concurrent trigger runs per plugin and one per thread; when full, record a skipped-busy diagnostic and do not queue unbounded work. Deduplicate stable event identities where available within the process; no replay or exactly-once guarantee is promised.

Write a bounded summary under Judge's thread metadata namespace: run ID, set ID/hash, timestamp, outcome booleans, completion/calibration status, and short configured badge. Keep at most 20 set summaries and 32 KiB serialized, evicting oldest entries. Clear/replace stale badges on newer unavailable/uncalibrated results and disable/remove. Metadata failures do not erase the database result; expose a publication failure.

Add a thread Info row as the primary display, with optional row metadata. Read summaries in bounded keyed batches (up to 200 threads), validate stored data, and refresh through realtime signals. UI and other plugins must not treat metadata as authorization or independently verified truth.

## Public surfaces

Declare CLI with `defineCli`, RPC with `defineRpcContract`, strict input/output schemas, and bounded output. CLI and RPC call the same services. Every command supports help; JSON behavior must be explicitly declared and tested rather than assumed automatic.

Planned commands:

```text
bb judge ask <set> [--thread <id>] [--model <id>]
bb judge ask --noul <question> --state <json> [--model <id>] [--not-private]
bb judge questions list|show|save|remove|export|import ...
bb judge templates list|use ...
bb judge models list|add|default|check ...
bb judge triggers list|add|remove|enable|disable ...
bb judge test <set> [--model <id>] [--compare <id>]
bb judge calibration accept <set> --run <test-run-id>
bb judge log [--set <id>] [--thread <id>] [-n <count>]
```

File-consuming commands require resolved caller host identity and use `bb.sdk.files`; offer `--machine` when there is no calling thread. Exports print YAML to stdout so caller shell redirection chooses the destination. Bound log/list pagination; never print credentials. Define structured multi-step input overrides in RPC first; defer ambiguous CLI `key=value` parsing until its encoding is specified.

RPC minimum: `ask`, `run`, `sets.list`, and `verdicts.keyed`; management methods arrive with their CLI/UI stage and reuse the same validation and activation rules. The later `judge_ask` tool is off by default through `bb.agents.configure`, with no mutating management operation. Author the agent skill only after real command behavior exists. Add custom settings UI for models, project applicability, and triggers with the frontend stage; flat connection secrets use BB descriptors.
