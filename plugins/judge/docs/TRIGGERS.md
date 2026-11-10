# Explicit event bindings and verdict publication

Triggers bind one saved global question set to `thread.idle` or `turn.failed`. Saving a new binding, importing its structured definition through RPC, or editing an existing binding always disables it. Enabling is a separate explicit operation. A binding can record attempts without badges, or map named final outcomes to short badge labels. It cannot send messages, notify, invoke arbitrary actions, alter private-data permission, or establish calibration.

```sh
bb judge triggers add attention --set my-attention --event thread.idle --projects '["project-id"]' --badges '{"needs_attention":"Needs attention"}' --json
bb judge triggers show attention --json
bb judge triggers enable attention --json
bb judge triggers log --trigger attention --limit 20 --json
bb judge triggers disable attention --json
bb judge triggers remove attention --json
```

`add` and its `save` alias replace the configuration at that ID and disable it. `projects` is `all` or a JSON array of 1–100 project IDs. Badge keys must name the saved set's final outcomes; values are nonempty text labels of at most 64 characters without controls. At most 64 badge mappings and 1,000 configurations are stored. `list --limit 1..20 --after <next-id>` returns full bounded configuration pages; `show` returns one record. Every edit and enable/disable transition generates a new revision so an old in-flight attempt cannot regain permission after disable/re-enable. Save, enable and other management commands perform no inference themselves.

RPC management is `triggers.list`, `triggers.show`, `triggers.save`, `triggers.enable` `{id,enabled}`, `triggers.remove`, and `triggers.log`. Save accepts `{schemaVersion:1,id,setId,event,projects,badges}`, with version/projects/badges defaults, and rejects activation flags or arbitrary actions. There is no trigger file importer or server-side path read. Structured saves never inherit enabled state. CLI and RPC use the same services and strict schemas. Enabling is a workflow control, not proof that the caller is human; BB does not distinguish a human from an agent using the same client capabilities.

## Selection, privacy and calibration

Effective applicability is the intersection of the project switch, saved-set project filter and trigger filter. The default project switch is on, but bindings are disabled until explicitly enabled. Changing a set disables its dependents and retires acceptance; project-switch edits conservatively disable all bindings. Model/default/connection edits invalidate acceptance and abort active work. Binding revisions are separate from model generations: enabling a binding does not destroy the calibration evidence it needs. Explicit reacceptance and report retention retire older display references through post-commit notifications without changing model generations or triggering inference.

A matching enabled binding may make paid provider requests. It uses the saved definition's model selection, lazy sources, private-data rules, single permitted fallback, cache, outcomes and whole budget. It has no event-specific privacy override. Synthetic case acceptance still needs the actual resolved fingerprints of every executed model, including private fallback paths. Saving a label, declaring `calibratedFor`, or enabling a binding never establishes acceptance.

Every attempted execution records a run, including unavailable, busy and duplicate diagnostics. Complete but uncalibrated results remain records. Only a complete, calibrated, applicable, current verdict can publish configured badges. A record-only binding has no metadata action. Triggers are not a quality certificate, and example thresholds remain subject to local evaluation.

## Separate event adapters and freshness

The idle adapter receives the supplied thread DTO and latest assistant text or null. Null remains absent evidence; it never falls back to an older output. The failure adapter receives its own request/turn IDs, attempt count, input-accepted fact and optional error message, then resolves verified thread/project context inside the admitted execution budget. It does not cast the failure payload to an idle payload. Failure message data remains sensitive; identifier-only event projections follow the source policy.

A failure must still match the most recent retained `client/turn/requested` ID. Missing or incompatible request history is unavailable, rather than an invented current failure. Snapshot checks use the verified thread/project/environment/status/update stamp, latest event sequence and failure request ID. The runner still verifies its own context. Trusted event/idle source context is internal to event execution; public run RPC cannot submit it or bypass privacy.

Before publication Judge rechecks the event/thread stamp, set hash, binding enabled state/revision, project applicability, current accepted fingerprints and model generation. It also validates again after a metadata write. Edits, disable/removal, model changes, thread activity or a newer observed event abort active work and invalidate derived display references. Lifecycle observers for activity/archive/delete/failure and coalesced sequence updates only clear stale state; they are not additional inference trigger kinds.

Idle deduplication uses the supplied thread ID/update timestamp; failure deduplication uses request/turn/attempt identifiers. The process retains at most 1,000 identities for five minutes. Duplicate delivery produces a diagnostic without inference and does not cancel the original attempt. Events lost while unloaded are not replayed. Same-timestamp idle transitions may be indistinguishable, and no durable replay or exactly-once behavior is claimed. Source and metadata reads are separate public SDK observations, not an atomic snapshot of BB.

## Admission and lifecycle

At most two trigger runs are active per plugin and one per thread. Admission reserves a slot before SDK reads. When full, Judge records `trigger_busy` and does not queue inference. Multiple matching bindings on one thread obey the same rule; later bindings may be skipped busy. A genuinely newer event supersedes/aborts older work; if its slot is still occupied, the new event is also recorded busy rather than queued. Duplicate events record `duplicate_event`. Inapplicable attempts record `set_not_applicable` without a provider request.

Snapshot collection, runner sources and inference share the set's execution budget. Publication has a separate five-second bound and retains cancellation. Disposal aborts active jobs and waits for their bounded cancellation records before SQLite closes. Reload retains definitions and explicit enabled choices, retires opaque model/calibration identities, and reconciles stale display references. Reload and startup never replay events or start provider calls.

## Compact, untrusted display state

Judge's metadata namespace contains only `verdicts:{version:1,summaries:[...]}`. A summary holds run/set/hash/binding/revision identifiers, timestamp, final booleans, completion/calibration flags and configured labels. It contains no raw answers, source state, failure text or keys. Keep at most 20 summaries per thread and 32 KiB of serialized UTF-8 metadata, evicting oldest entries until both bounds fit. Short labels and IDs remain display text, not executable actions.

SQLite holds authoritative runs and compact attempt/publication records. Attempt records cascade with the existing 30-day/10,000-run retention. Publication references are capped at 20 per thread and 10,000 globally; a pruned run leaves a tombstone so metadata cleanup can retire it. Metadata is not an access-control boundary, and other clients can write invalid namespace data. Keyed reads finish with a synchronous check of published references, binding revisions, set hashes and accepted fingerprints so a concurrent disable or replacement cannot return an earlier validated summary.

A metadata failure preserves the database verdict and exposes a sanitized publication status/code through `triggers log`. Disabling/removing a binding, an unavailable or uncalibrated newer result, and invalidation retire the authoritative reference immediately and attempt metadata clearing. Writes are not queued: at most two actual metadata mutations and one per thread can remain in flight. A mutation that ignores abort keeps its slot until it settles, then a coalesced cleanup pass can remove late stale data. Cleanup is bounded, best effort and never retries inference. Host/transport failure cannot guarantee a physical metadata mutation; authoritative reads hide stale or failed data even when raw namespace clearing has not completed.

`verdicts.keyed` `{threadIds}` accepts 1–200 unique IDs, uses the public keyed metadata read, validates each namespace, and returns only summaries matching current published database evidence and source/configuration stamps. It also returns a sanitized `publicationFailure` code when available. Forged, corrupt, uncalibrated or stale metadata cannot become a current Judge badge. The batch has a five-second budget and propagates cancellation. The SDK can buffer its raw metadata response before projection; local output remains at most 200 rows of bounded summaries. Metadata never authorizes an action or independently proves model correctness.

## Verification scope

Offline tests use recorded transports, synthetic events and fake SDK/SQLite hosts. Coverage includes disabled defaults and strict CLI/RPC; edit/toggle revisions; project/private policy; separate idle/failure context; missing/null evidence; dedup/busy limits; event/config/disable/removal races; retained cancellation records across fake-host reload; late metadata completion; caps/eviction/corrupt data; sanitized publication failure; authoritative keyed reads; and legacy migration/retention/rollback. No real source values, credential reads, provider calls, installation or live runtime reload were used for these tests. Live event delivery/history retention, metadata behavior, provider quality, Info/sidebar UI and remote/sleeping hosts retain their later verification gates.
