# Automatic conversation continuity

## Product contract

Bob's stable identity and logical conversations outlive physical provider sessions and BB threads. Main and working conversations both preserve soul, relevant memories, active obligations, task source, assignment/reporting contract, pending decisions and history references. Matt should not manually prepare or reconnect routine handoffs.

This remains the continuity goal, with feature-specific support gates rather than a hold on all plugin development. Unsupported automatic paths remain disabled and visibly recoverable through supported user-driven actions; do not advertise seamless recovery on those paths. First verify whether the public SDK can compact or replace a provider session inside a visible thread, and when a successor BB thread is required. Publish a supported-provider matrix and visible degraded states. Never silently reduce the requirement to “the operating skill should remember.”

## Prefer the least disruptive supported transition

The preference ladder is: (1) native compaction, (2) verified in-thread context clear plus bounded re-brief, (3) a successor physical thread only when those paths are unsupported or insufficient (for example a required provider change). BOTS-3 answers this first. Public declarations expose compact, clearContext and compactFirst, but clear/re-brief semantics and instruction reconstruction remain runtime questions. Save the continuation record before any context clear; do not clear an active turn or discard the only copy of working state.

Keep cheap stable logical IDs from the start, but build successor cutover machinery only for a verified need. In-thread reuse avoids unnecessary migration of drafts, pins, parent links and queues. No path may claim readiness until its pickup and state-preservation checks pass.

## State and small implementation boundaries

Keep identity/storage, conversation routing, continuity policy, task integration, memory maintenance, and UI separate. Use logical conversation IDs as enduring references; maintain a current physical thread mapping and predecessor history. Contracts targeting a bot-owned role resolve through its logical conversation. An external ordinary thread target remains an explicit physical reference unless it exposes its own supported successor contract.

For whichever transition path is selected, persist the minimum record required for restart recovery: source/current generation, checkpoint and recent-state summary, intended successor identity, preparation/pickup status, cutover status, outstanding inputs/reports and recovery error. Exact schema follows capability verification. A process-local lock or timer is not enough to recover after restart.

## Normal transition

1. Save durable state throughout normal work, not only when a context threshold is reached.
2. At a supported safe boundary, inspect fresh context usage/headroom and provider capabilities. Prefer native compaction when supported.
3. Check resulting usage when fresh measurement is available. A resolved API call alone is not evidence of reclaimed context. Missing/stale data must not cause repeated compaction loops.
4. If compaction is insufficient, prefer tested in-thread clear/re-brief; use a successor only if required. Capture a bounded continuation package: soul/config revision, relevant memory references, active commitments/task-source references, role/assignment/contracts, recent decisions and pending inputs, history links, environment, manual-stop evidence and maintenance setting.
5. Prepare the refreshed session or conditional successor without executing the assignment or replaying side effects. Any model-backed pickup verification or re-brief obeys the activation rule below; it is not automatically permitted because the source is idle. Confirm it loaded the intended checkpoint, can access the task source and working environment, and retains its reporting destination. A nonempty reply alone is insufficient.
6. Switch the authoritative logical-to-physical mapping only after pickup verification. Reconcile new inputs/reports accepted during transition, preserving order, attribution, reply destinations and acceptance evidence.
7. For a successor, preserve predecessor history. Define how old physical-thread inputs are handled: plugin routing alone cannot redirect every native Send-now path. Mark the predecessor as continued, link to current, and reconcile or visibly reject/hold stale input through supported APIs. If this cannot be guaranteed, do not enable that successor path. Re-parent only affected bot-owned children where needed to prevent native notifications reaching the old session; preserve unrelated parentage, verify notifications, and do not mutate unrelated threads. Check physical-thread automations and pins as well. Do not automatically archive the predecessor until descendant/environment/queue consequences are proven safe. Replacement must not retire the home or strand workers.

Transition ownership and generation checks must prevent two concurrent successors becoming current. Restart recovery inspects persisted state and existing candidate threads before creating another. Failed pickup leaves a recoverable source/transition record and actionable UI. If a source becomes unusable, do not pretend routing succeeded; show the held inputs and recovery action.

## Delivery, side effects, and drafts

BB native queues are the initial transport. Determine their behavior during cutover rather than inventing a second general message broker. Track only the transition-specific state that public primitives cannot guarantee. If an accepted send has uncertain execution, reconcile receipts/history or surface ambiguity instead of resending blindly. Do not promise exactly-once external actions from a session summary.

Typing/attachments must survive navigation and longer transitions. Messages submitted during cutover must have a known destination or explicit pending state; they cannot disappear or execute in both source and successor. Validate report and reply routing after both main and worker handoffs. Keep parentage independent: successors must not accumulate an artificial ancestry chain merely to represent continuation.

## Activation rule and coexistence

Idle/failed status alone never authorizes a model turn. Non-turn maintenance (bounded storage updates or eligible native context operations) can run at a verified safe boundary without executing work. Model-backed pickup, re-brief, summary and dream turns require the relevant automation policy and no unresolved manual stop; otherwise defer them to the next user-authorized dispatch. Verify manual-stop evidence and dispatch-hold semantics for Bots-owned actions. The current runtime cannot provide a universal guard over another plugin’s native context operations; this is a visible coexistence limitation, not a prerequisite for identity, storage or UI. Do not equate ordinary successful settlement with a manual interruption, and do not guess when causal evidence is absent.

Other installed plugins may compact, retry, hand off or schedule the same physical threads. Observe native compaction/context events and recent fresh usage before initiating another compaction; avoid assuming Bots is the only writer. BOTS-3 verifies coexistence with auto-compact, provider-retry, handoff, automations and side-chat. BOTS-12 defines one retry/fallback owner and ordering, including supported provider-retry consent APIs if present; never let both independently repeat failed work. Do not disable or reconfigure the user's plugins as a shortcut. Unsupported coexistence is a visible support limitation and test gate.

## Model fallback and user stop

Configuration includes main, fallback, and working-thread model choices with supported reasoning options. Initial proposed fallback policy is conservative: only provider/model unavailability or a classified unrecoverable session failure may trigger a verified switch; ordinary task/test failure, an approval wait, or a user stop must not. Bound attempts and surface the switch. Preserve permissions rather than broadening them. Final failure classification and same-provider/cross-provider support must be validated against public APIs before enabling automatic fallback.

Manual-stop/cancel intent and the maintenance setting survive transitions, reloads, and model switches. `thread.idle` is an observation and cannot authorize work. There is no bot-wide pause primitive in the confirmed v1 design; use the precise native Stop and explicit-report semantics in spec.md. Workers and maintenance need explicit policy/ownership rather than being restarted by an idle handler. Provider-native within-turn context handling must be investigated separately: after-turn hooks alone cannot guarantee a single long turn never exhausts its context.

## Required verification

- Supported native compaction with fresh usage; unsupported provider; stale/missing usage; ineffective compaction.
- Main and worker replacement; pickup failure; host/task-source unavailable; process restart at preparation and cutover; competing transition attempts.
- User input and worker reports before/during/after cutover; uncertain send result; reply to a predecessor; preservation of draft/attachments and old history.
- Active worker with non-main reporting target, continued assignment, correct parentage and stable bot destination.
- Manual stop during transition, maintenance disabled during a run, no automatic restart of stopped work, explicit reports waking a new recipient turn without resuming canceled work, fallback after provider failure versus ordinary task failure.
- Archive/retirement effects and home retention, checked without deleting live user data.

Record actual capability evidence and residual gaps. No core modifications, provider-internal imports, destructive cleanup, or live handoffs of unrelated user conversations are authorized by this plan.

## Initial durable preparation slice

The offline CLI prepares immutable checkpoint and recent-state/knowledge/obligation references for a SQLite-owned main or worker, with its current task-source and reporting-contract revisions. Source captures are scoped to the selected physical thread's canonical source. A retained UUID recovers the same preparation without another native read; a failed final write rolls the checkpoint back too. Saved packages carry no copied note or queued-message bodies. Reads apply current exclusions, distinguish changed revisions and re-read current authoritative obligations/contracts instead of reopening cached work.

Native readiness only observes public thread/context/event/queue state under a bounded request signal. It exposes snapshot age/estimation, bounded Stop/context-change events, parent/pin metadata and queue count/IDs, while recording that process settlement, current-session identity, dispatch permission and pickup are not established. A newer context change or an equally recent/newer differing-session usage event makes an apparently recent snapshot stale; old-session events preceding the snapshot do not. Saved obligation references off the current status page are explicitly unknown and retain a cursor/specific-record read path, never an inferred completed or open state. The public queue list has no pagination; output is bounded and a larger/inconsistent queue is explicitly incomplete. No native operation or mapping cutover is implemented or enabled by preparation. The full verification list above remains open, including actual provider compaction effectiveness, clear/re-brief semantics, Stop/coexistence and any necessary successor/draft/input/report reconciliation.
