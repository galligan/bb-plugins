# Session delivery

## Principle

Durability, attention and execution are separate. Posting records communication. Listening selects relevance. A delivery adapter surfaces it. A bot or user decides whether future work is authorized.

“Noninterrupting” can mean no forced new turn or no mid-task input at all. Expose that distinction rather than hiding it behind one promise. Explicit stop takes precedence over notification delivery. A naturally completed turn, interrupted turn, failed turn and user-stopped session are not equivalent.

## Candidate adapters

| Path | Basis | Limits / verification needed |
| --- | --- | --- |
| Explicit `check` / inbox read | Native tools, CLI and HTTP | Reliable baseline; hookless clients participate fully |
| Piggyback on tool results | Radio can add pending digests to its own results; bot tools can call Radio RPC | No public universal wrapper for arbitrary tools was found; counts are hints, not receipts |
| Bounded `listen` tool | Native tool execution plus cancellable AbortSignal | Cooperative foreground wait; test provider timeout, cancellation and concurrent tool behavior |
| Guarded live steer | Send modes plus `message.dispatch` start/join distinction | Promising composition, not verified atomic join-only delivery |
| Explicit composer mention | Mention resolver adds fresh agent context at message send | User-selected context, not automatic every-turn enrichment |
| Session-construction instructions | Agent configure/contributeInstructions | Standing guidance and snapshot only; live sessions retain construction-time instructions |
| Provider-native hooks | Candidate provider-specific adapter | Discover actual support; no configuration or runtime behavior verified |
| Safe completion subscription | Proposed SDK extension | No generic public pre-completion inbox hook found |

### Piggyback and listen

Return a compact digest with normal Radio operations; optionally allow cooperating bot operations to include it. Never change unrelated tool results through undocumented interception. Include content only when desired and bounded; otherwise return count and retrieval instruction.

A `listen` call waits for eligible txs or a bounded timeout. Cancel on tool cancellation, explicit stop, thread deletion or plugin disposal. Timeout does not automatically rearm. Agent guidance must prevent polling loops. This call is not a detached background subscription; provider/runtime behavior needs a small probe.

External HTTP can use cursor polling first. SSE/WebSocket or long polling may later reduce latency but do not establish model receipt or participation by themselves. Disconnects leave durable messages available.

### Guarded steering

The public SDK supports steer modes, but a steer with no running turn can become `start-turn`. A prior idle/active check is insufficient.

Candidate composition: for a notification originating from Radio, permit `message.dispatch` only when `attempt` is `join-turn`; reject `start-turn`. Keep the transmission durable after rejection. Do not turn rejection into a delayed wake. Scope the policy to Radio's notification attempts so ordinary user work is unaffected.

The hook is re-evaluated on drains/retries, but mixed grouped messages, other plugins' waits, explicit send-now bypass, plugin disposal and stop races require tests. Rejecting a mixed group may affect unrelated messages; avoid grouping notification attempts with user work and do not infer origin from only the first row. Do not ship this as a stop-safe guarantee without proving the full path. Unknown send outcome does not authorize blind resend.

Live steering adds input to ongoing work, even if it does not end the turn. Make it opt-in and batch hints. It must not automatically ack or accept work.

### Hooks and future extension

`thread.idle` is observe-only and lacks causal completion/stop evidence. It can refresh passive UI/bookkeeping. Do not attach unconditional sends to it. Events missed while unloaded are not replayed; reconcile durable records rather than assuming callbacks are a journal.

Provider-specific session/tool/turn hooks may support fresher context. Investigate each installed provider and use documented configuration. A user stop must disarm automatic continuation; `out` ends session listening, not persistent actor obligations.

BB already has detached native-tool results for genuine `bb.ui.requestInput` forms, with stop/delete/disposal cancellation. This is a useful architectural precedent for a generic cancellable subscription/result API. Do not open fake forms to acquire background delivery.

A focused SDK request could provide safe-boundary context injection or cancellable detached listening with explicit normal-completion, failure and stop reasons, bounded payload, cancellation guarantees and delivery evidence. This is preferable to undocumented core access.

## Bot execution policy

An explicitly “on duty” bot could eventually authorize pickup after natural completion. That authority belongs to its reporting/execution contract, not to channel membership or a broadcast. Stop/restart/handoff must preserve whether that duty is armed. Do not automatically restore it from an active goal flag or mere session presence.

Responsibilities and canonical addresses persist through compaction and handoff. Fresh instruction resolution on compaction itself is not guaranteed. Use durable bot records and explicit context/read operations.

## Probe matrix

Before claiming an adapter works, test normal completion, manual stop while active, stop while waiting, error, archive/delete, plugin reload/unload, unsupported provider, response loss, duplicate signal and session restart. For steering, additionally test active-to-idle races, grouped queues, waits and send-now overrides. Verify no stopped session restarts, no receipt is fabricated, and unreceived content remains discoverable.
