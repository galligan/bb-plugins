# Implementation plan

Each stage is a focused change with tests and README updates. Do not advertise later commands in the manifest or install collection before implementation. The [spec](SPEC.md) owns behavior; the [compatibility review](COMPATIBILITY.md) identifies live validation gates.

The [task board map](TASKS.md) links the parent delivery task and dependency-ordered subtasks. BB Tasks is the execution-status source of truth.

## 0. Preparation — this change

- Minimal headless manifest/server scaffold in `plugins/judge`, generated with BB then stripped of the todo demo.
- Original proposal retained byte-for-byte; corrected spec and evidence alongside it.
- Typecheck and bundle without installing the plugin into the running server.

## 1. Explicit ask

Implement request/answer schemas, secret connection settings, model records, privacy resolution, the two bounded fetch adapters, SQLite run records, and CLI/RPC ad hoc ask. No triggers or custom frontend; BB renders the connection secret descriptors in its existing settings UI.

Acceptance: recorded fixtures cover noul/choice/score, both envelopes, missing usage, wrong IDs/types, invalid distributions, HTTP errors, oversized body, timeout, cancellation, and private fallback. Assert a forbidden request never reaches network or cache. Exercise CLI help/JSON and RPC validation with the SDK fake host. Make one explicit credentialed smoke request per provider before claiming live support, recording model version and latency without state or secrets.

### User checkpoint: Jev credential

After the settings descriptors and offline ask tests are ready, install the development plugin for live verification and guide the user to Settings → Installed plugins → Judge to enter the Jev / TypeSafe API key directly. Verify the actual GUI path first. Never request or read the key through agent tools. Check sanitized readiness, then make a tiny explicit synthetic smoke request. Missing credentials block only credentialed verification, not other implementation tasks.

## 2. Saved sets and sources

Add bounded YAML import/export, canonical hashes, global project filters, source adapters, outcome validation, and ordered runner. Add only verified source projections; unsupported sources return `source_unavailable`.

Acceptance: gates resolve inputs lazily; unknown/forward/cyclic references fail import; skipped and unavailable results differ; no negation turns unavailable evidence into an action. Deadline covers source reads and all steps. Test private fallbacks and caller-input sensitivity, project filters, goal-cleared events, history pagination, upstream truncation, disabled Git plugin, sleeping host, and remote file routing. Demonstrate two steps with a deterministic recorded transport before live inference.

## 3. Templates, evaluation, and cache

Ship three templates with explicit cases, copy/import provenance, live test/compare reporting, calibration acceptance, bounded response cache, and retention.

Acceptance: copied templates never activate triggers or claim calibration. Edited sets/models invalidate acceptance. Cached requests still enforce privacy and write runs. Changing endpoint/configuration cannot reuse old answers. Case reports distinguish unavailable from failed expectation; compare highlights disagreements without asserting which model is correct. Completion template describes observed evidence limits.

## 4. Opt-in triggers and verdict UI

Add disabled-by-default event bindings, bounded concurrency, configuration/event freshness checks, record and badge actions, compact metadata publication, Info row, optional sidebar row metadata, and settings UI.

Acceptance: only enabled, applicable, complete, calibrated, current runs publish badges. Test duplicate/busy events, edit/disable during inference, disposal/reload abort, metadata caps/failure, and stale-badge clearing. Live-check the Info row while sidebar metadata is off, then verify optional badges when enabled. No thread messages or external plugin actions occur.

## 5. Agent access and release preparation

Add the opt-in `judge_ask` tool and a skill documenting implemented commands and question-authoring guidance. Reuse the runner and privacy policy; tool arguments cannot enable triggers or change connection policy.

Acceptance: tool excluded by default and selected only by plugin configuration; help, examples, and skill match implemented behavior. Run all repository checks, inspect a clean standalone package install/build, and verify the public-SDK-only import scan. Add the collection entry only when the usable package meets these gates. Treat send, arbitrary RPC actions, and notifications as separate future proposals.

## Verification commands

Use Bun 1.3.14 from root:

```sh
bun install
bun run format:check
bun run lint
bun run check
bun run test
bun run build
```

Keep deterministic tests offline. Credentialed model tests are explicit separate commands, never part of default CI. Use the pinned public SDK testing harness and its SQLite peer for storage tests. Do not hand-edit generated SDK declarations or build output.
