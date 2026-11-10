# Case evaluation and explicit calibration acceptance

`bb judge test <set-id> [--model <primary-id>] [--compare <second-id>] --json` evaluates the saved definition's authored cases through the same runner and transports as an ask. It can make paid provider requests. Listing, copying, saving and reading a definition still make none. The CLI uses the calling project for applicability; RPC `test` accepts `{id,model?,compare?,projectId?}`. Cases bypass live source reads and thread context, but every supplied value remains sensitive. Model privacy and the one permitted private fallback still apply; test has no `notPrivate` escape.

```sh
bb judge test my-attention --model my-primary-model --json
bb judge test my-attention --model my-primary-model --compare my-second-model --json
bb judge calibration accept my-attention --run <evaluation-report-id> --json
```

The test returns a distinct evaluation report ID. Each attempted case also has its ordinary run ID; those are different identifiers. Retrieve a saved sanitized report with RPC `tests.get` `{id}`. The existing `runs.get` reads a case's typed answers/model provenance when deliberately requested. Neither test reports nor run records contain captured source state or credentials; authored cases remain in the saved definition as authored data.

## Reports and comparison

Reports classify each case as `correct`, `incorrect` or `unavailable`. A correct case has a complete verdict and all final booleans match its authored expectation. An incorrect case has a complete verdict with at least one mismatch. Missing evidence, policy refusal, provider errors, timeout and cancellation are unavailable, never an invented false answer that can pass an expected negative case.

Each variant reports per-outcome correct/incorrect/unavailable counts and accuracy among **available** cases only. Accuracy is null when none were available; unavailable counts always remain visible. It also reports successful/skipped/unavailable step counts, case durations/run IDs, requested model IDs and the identities/fingerprints of actual resolved models, including private fallbacks. Returned provider model labels remain in the linked case run records. These labels and configured selectors cannot establish immutable weights; repeat evaluation when provider changes are known.

Comparison runs primary then comparison sequentially over the same authored cases. It lists each case as agree/disagree/unavailable and names differing outcome IDs. It does not choose a winner. Requested models can resolve to the same private fallback; inspect actual identities before interpreting a comparison as two different configurations. Per-outcome matches describe these authored expectations and do not establish general accuracy or case coverage.

Reports include expectation booleans, diagnostic codes, counts, timings, set hash, case/run IDs, model identities and a process configuration generation. They omit case payloads, raw answers, credentials and upstream error bodies. Strict validation checks internal counts, case order, completeness and disagreement consistency. Report records are immutable and capped at 1 MiB. A conservative size preflight reserves diagnostic overhead before dispatch. Reports are pruned to 30 days and 1,000 entries opportunistically on report writes; pruning a report also retires its linked acceptance. Existing per-case run retention applies independently.

## Execution bounds

At most one evaluation runs at a time, with no queue. A definition has at most 100 cases and 16 steps; comparison has at most two variants. The planned request upper bound is cases × steps × variants (at most 3,200); gates and refusals reduce actual requests. One 30-second evaluation execution budget bounds all cases and variants. Each case also retains its set's own budget and the model request timeout, capped by remaining evaluation time. No request starts after expiry. Final persistence completes the truthful attempt record after execution.

Caller cancellation, plugin disposal and configuration invalidation abort active work. Completed case records remain visible; unstarted cases are explicitly unavailable with null run IDs and zero steps. A failure during final report validation makes the report incomplete without erasing completed cases. Timers/listeners and the active-evaluation slot are released on success, cancellation and operational failure. A storage error returns no successful report or acceptance.

## Acceptance is a separate decision

`calibration accept <set-id> --run <report-id>` and RPC `calibration.accept` `{id,run}` explicitly accept the **primary** variant's actual resolved fingerprints. Comparison is measurement, never an automatic model selection. To accept the other model, evaluate it as primary. Test alone never writes acceptance, and `calibratedFor` remains an intended-model declaration.

Acceptance requires the exact persisted, complete, non-stale report, the current set hash and full case suite, and current primary model fingerprints/configuration generation. Every selected comparison variant must also have completed; a partial comparison report cannot establish acceptance. The caller must review incorrect-case counts before accepting. A complete report may contain mismatches: explicit acceptance records that decision and does not certify perfect accuracy. No automatic threshold or winner substitutes for it.

The stored record links the exact report ID, set hash, observed primary fingerprints and acceptance time. Wrong/missing evidence, corrupted linkage, cancellation, stale configuration or a subset masquerading as the full suite is refused. A final synchronous check closes the await gap before the transaction. Acceptance changes no model private-data policy, defaults, definition, trigger enablement or provider settings.

A saved verdict is calibrated only when complete and every executed step's actual resolved fingerprint appears in a matching accepted set hash. A model used only on a previously skipped path remains unaccepted. A public-source run that resolves a different model from a case's private fallback remains uncalibrated. Ad hoc asks never gain a saved-set calibration claim.

Set/model/default/project/connection edits invalidate acceptance. Plugin reload conservatively retires opaque connection identities and acceptance, so run a fresh evaluation and accept its new report afterward; an old report cannot be silently restored even if the process generation happens to have the same number. RPC `calibration.get` `{id}` returns only current acceptance or null. These client calls are explicit workflow controls, not proof that the caller is human.

## Verification scope

Default tests use recorded adapters and fake SDK hosts. They cover report statistics, disagreement/fallback identity, privacy and applicability, partial and invalid responses, whole-budget/caller/disposal/configuration abort, concurrency, final validation, stale/subset/fingerprint rejection, await-gap safety, calibrated runtime checks, report/acceptance rollback and retention, legacy migrations, CLI/RPC/help and fake-host reload. No live model request or real private state was used to validate this implementation. Actual model quality, provider version behavior, remote-host integration, cache, triggers and UI retain their separate gates.
