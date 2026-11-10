# Saved-set execution

`bb judge ask <set-id> [--thread <thread-id>] [--model <model-id>] --json` and RPC `run` execute the same sequential runner. CLI uses the calling thread/project unless an explicit thread is supplied. RPC accepts `{id, threadId?, projectId?, model?, inputs?}`. It has no environment override, private-data disclosure flag, activation option or arbitrary action.

The runner loads the authoritative normalized definition and hash, validates arguments, then reads the supplied thread's public DTO to establish project/environment context. A caller-supplied project must match the thread. The set's project filter and project switch must allow execution; a context-free call can run only unrestricted sets. An inapplicable attempt records `source_unavailable` / `set_not_applicable` without reading inputs or dispatching inference. Unknown sets, unknown override names and mismatched explicit contexts are boundary errors, not invented model outages. Unreadable thread context produces a bounded unavailable result. No implicit current/default environment or host wake is used.

## Step order and failure

Steps run in definition order. Their `when` gate sees only earlier boolean outcomes. A false gate records `skipped` / `gate_false`, contributes false values for its named outcomes, and resolves no inputs or model request. Each running step resolves exactly its declared inputs and makes one inference request. Later steps receive their own state object and cannot read earlier raw answers. Missing evidence is never coerced to false under `not`.

Unavailable evidence, provider failures, invalid responses, policy refusal, timeout or cancellation stop execution. The current step is `unavailable`, every later step is `skipped` / `upstream_unavailable`, the verdict is incomplete and final outcomes are empty. Successful steps retain their answers and provenance. If final evaluation or verdict validation fails after the steps finish, an optional run-level `failure: {reason,code}` records that failure without replacing a completed step. The run remains incomplete with empty final outcomes, and log summaries carry the diagnostic too. Gate skips are ordinary complete-run behavior and may participate in explicitly authored final boolean expressions; they differ from outages.

Every attempted execution returns a validated verdict only after the run/steps transaction commits. Persistence failure is an operational error and suppresses successful CLI/RPC output. Raw source state is not stored or logged. The direct caller and bounded run database retain typed answers, boolean outcomes, selected model identities and source provenance. The runner does not publish metadata, badges, messages or other actions.

## Privacy and overrides

Model resolution occurs independently for each running step: call override → step model → set model → explicit global default. Every collected input contributes its source classification. Private inputs can fall back once to the configured private default only if that model allows private input; otherwise dispatch stops before network/cache access. Successful steps record requested and resolved identity/fingerprint, actual returned provider model and fallback reason.

RPC `inputs` supplies partial overrides keyed by step and input name, for example:

```json
{
  "id": "needs-attention",
  "inputs": { "main": { "last_message": "Synthetic fixture text" } }
}
```

Only declared names are accepted. An override bypasses that live source but is always sensitive, including public-looking identifiers or authored fixtures. It cannot grant model private-data permission. Each value must satisfy the input byte/JSON bounds and its source's character cap; all overrides together are bounded. Provenance uses `caller_override`, not a fabricated source observation. CLI deliberately has no ambiguous `key=value` override syntax. `--not-private` remains limited to ad hoc asks and is rejected for a saved set.

## Deadline and lifecycle

The definition's default5-second budget (maximum30seconds) begins before definition loading. One monotonic deadline covers context reads, lazy source reads, inference, response/outcome evaluation and verdict validation. Each request receives that deadline and the model's timeout, so it uses the lesser remaining duration. Per-request timeout is `timeout`; exhausted whole budget is `budget`; caller disconnect or disposal is `cancelled`. Even an SDK/fetch fixture that ignores abort cannot dispatch later work after the run stops. All deadline timers/listeners are cleaned up. Persistence records the resulting attempt after execution; it does not convert a timeout into success.

Set/model/default/project/connection invalidation aborts an in-flight run so it cannot continue across a configuration edit. Plugin disposal aborts runner, source and inference services. This is execution freshness, not trigger publication freshness; event-generation checks and publication arrive with triggers.

## Verification and remaining gates

Recorded offline transport tests exercise two-step success, lazy skips, first/later outages, malformed answers, model precedence/private fallback, sensitive caller overrides, Git environment routing, project filtering, unknown/mismatched context, expiry before/within reads, per-request vs whole-budget diagnostics, cancellation/disposal/configuration edits, timer cleanup and persistence failure. CLI/RPC share these mechanics and their cancellation path. Existing source and transport suites continue to validate their bounds and contracts. Request assembly includes question text and retains the transport's complete-request byte/depth limits; a source value that cannot fit those enclosing limits is an unavailable request, not silently simplified evidence.

Saved-set runs become calibrated only after explicit acceptance for the current set hash and every actually executed model fingerprint. Untested gated paths or a different public/private resolution remain uncalibrated. See [case evaluation and acceptance](EVALUATION.md). Cache hits, triggers and display follow separately. Offline runner tests make no paid/live request and grant no private-data policy. Remote/sleeping-host behavior and end-to-end live source/provider workflows remain later verification gates.
