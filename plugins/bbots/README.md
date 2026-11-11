# Bots

Persistent collaborators for BB, independent of the selected sidebar. The first default collaborator is Bob, with a main conversation named `@Bob`.

**Development preview:** `bb-plugin-bbots` (plugin ID `bbots`, display Bots) implements an additive create/open panel, CLI/RPC creation, persistent host homes, revisioned identity/SOUL, future execution defaults and a named/pinned native main conversation. Automated continuity, maintenance, workers and model fallback are not enabled. BOTS-6 creation passed a bounded shared Dev check; configuration and the minimal UI have offline harness evidence. Visual host acceptance for the UI remains pending. Do not install it into a production instance as part of development.

The package uses the repository's published SDK pin (currently 0.6.138), with BB >=0.49.0 / runtime SDK >=0.6.132 manifest minima. The build pin is not the installed runtime SDK. Preflight reports the installed stable BB separately; new behavior must be checked on the actual target. BOTS-3 tracks affected feature limits; BOTS-18 stays deferred/non-blocking. No custom production core is required.

## Create and recover

Open **Bots** in BB's existing navigation. Choose **New bot**, a connected machine and a name (Bob by default). Leave execution choices at BB defaults, or use the native model/reasoning/tier and permission pickers. A custom home base is optional and must be absolute; responsibility associations initially remain empty in this minimal UI and can be configured through the CLI at creation. The panel uses native ongoing conversations rather than embedding another chat or replacing a sidebar.

Select an existing bot to inspect setup and open its ongoing conversation. **Check / resume setup** can finish partial provisioning, including its initial acknowledgement; it never blindly replays an uncertain prompt. Offline/missing-home errors preserve the recorded home. The owned conversation's header identity action returns to its bot panel; ownership comes from SQLite, never its title or metadata. Thread drafts, Stop, queues, Info and normal controls stay with BB.

The browser retains a request key in tab session storage before sending creation. An uncertain response exposes a read-only request lookup, not another create attempt; remounting the form preserves that recovery path. Once its recorded bot is found, open that setup. Closing the browser tab can remove the local key, while SQLite intent and the bot list remain authoritative. No automatic write retry runs. If session storage is unavailable, the form refuses to send; use CLI creation with an explicit retained request ID instead.

Before a new request saves immutable intent, a read-only host call validates the base using that machine's native path rules, resolves existing ancestors and refuses repositories or protected data paths without creating directories. A known refusal returns to the retained form for correction; an unknown response keeps its recovery key. Existing requests continue to reconcile their recorded setup. Custom execution seeds the native picker from a usable provider catalog, skipping empty/failed catalogs within a total ten-second, sixteen-provider read budget; no model turn or automatic execution fallback is involved.

Use `bb bot create --machine <host-id>` for Bob, or add `--name Alice`. Creation is an explicit user-directed action that starts one short setup acknowledgement; it does not assign work. Use `--provider` / `--model` for an explicit native choice, or inherit BB defaults. `--request-id <uuid>` makes retries with identical options resolve the same bot. Scripts should retain this key before submitting; repeating a CLI invocation without it is a new creation request. Use `--json` for bounded structured output. If another plugin owns the alias, use `bb plugin run bbots ...`.

The default home is `~/.bb-bots/<stable-bot-id>` on the selected machine, outside BB's plugin data and repositories. `--home-base <absolute-directory>` chooses another base; the operator must keep it outside BB-managed disposable folders. Creation refuses Git repository locations, occupied paths without the matching marker and symlinked homes. It never overwrites, archives or deletes home artifacts. A rename changes the profile and managed main title, leaving the IDs, home and current pin preference intact.

`--association-mode none|all|selected` records responsibility independently of the main workspace; repeat `--project <id>` with `selected`. These choices do not load repository instructions, adopt other threads or grant permissions. The native home project is a container for the main conversation, not a replacement for associations.

Use `bb bot list`, `show <bot-id>`, `resume <bot-id>` and `rename <bot-id> --name <name> --revision <current-revision>`. `list` returns at most 100 rows and a `hasMore` indicator. Resume verifies the recorded machine/home and existing main, and reconciles partial creation. It never resends the initial prompt, respawns an uncertain main or repins an existing thread. Offline or missing established homes produce visible errors; restore the original home/marker before resuming. Do not point an existing bot at a new empty directory as recovery.

Creation records SQLite intent before native side effects. The first ordinary dispatch binds exclusive main ownership from that intent before session construction; metadata is only a lookup mirror, not ownership authority. A lost receipt after this point recovers the recorded thread. If project creation lost its receipt or main creation failed before ownership was durably bound, the outcome is visibly uncertain and automatic adoption/recreation is disabled. Pre-existing home project matches are refused rather than adopted. Inspect the original native request and the bot's home project/queue; do not rerun with a new request ID as a blind retry. A successful Stop does not certify cancellation of held queue entries; use native queue cancellation to discard unwanted pending work. Bots cannot veto native Send now or another plugin's compaction/retry operations.

A small revisioned starter SOUL is created and supplied at configuration resolution so the first session has standing guidance. Soul text is not a live home file; session guidance is bounded to 16,000 characters. No idle/failed listener, schedule or automatic wake is registered.

Run package `bun run check`, `bun run test` and `bun run build`, then the repository verification before pushing. The real `server.ts` and `host.ts` are loaded through public SDK harnesses; provider timing, native Stop/queues, real routing and retirement require the separately scheduled Dev slot.

## Soul and execution defaults

Use `bb bot soul show <bot-id>` and `soul update <bot-id> --revision <current> --markdown <complete-markdown> --author <truthful-identity> --reason <user-instruction-or-approval>`. Updates preserve Markdown verbatim, append an attributable revision and reject stale bases, blank text or more than 16,000 characters. The `bbots-soul` skill helps propose a deliberate persona edit; ordinary observations and maintenance do not authorize rewriting it.

The display distinguishes current revision, last supplied revision and applied revision. **Applied revision is unknown:** the public synchronous configure callback can run without constructing a new provider session and has no session receipt. A newer edit is pending supply; a matching last supplied revision is still unverified for the live session. Editing starts no turn and performs no clear, compact or refresh. This limitation remains BOTS-3/BOTS-11 work rather than a fabricated applied marker.

Use `models show <bot-id>` / `models update <bot-id> --revision <current-or-zero> --defaults '<complete-json>' --author <identity> --reason <instruction>` for revisioned future conversation choices. JSON has `main`, `worker` and `fallback` fields. Each choice accepts native `providerId`, `model` and `reasoningLevel`; main/worker also accept `permissionMode` (`accept-edits`, `auto` or `full`). Start with `{"main":{},"worker":null,"fallback":null}`: omitted native choices inherit BB policy, and a null worker inherits the whole main choice. An explicit worker object is independent. Provider/model/reasoning availability is checked by BB when constructing the conversation, not asserted by saving this document. Fallback cannot change permissions and automatic fallback remains disabled.

Saving defaults does not mutate an existing main. Use its native BB controls for current execution choices; the minimal UI uses native pickers for new bot creation. New main creation accepts `--reasoning` and `--permissions` alongside provider/model, and pending pre-spawn setup uses the latest saved main defaults. `bb bot brief <bot-id>` pulls bounded current identity, home, revision/defaults and unavailable feature names. It does not inject full SOUL or assume fresh memory, tasks or reporting contracts. The UI's selected native service tier is preserved through creation rather than discarded.

## Bounded creation acceptance

[PR140](https://github.com/galligan/bb-plugins/pull/140) passed shared Dev acceptance on `77ebaf0`: BB 0.49.0 / runtime SDK 0.6.140, one connected host and Codex `gpt-6.1-sol`, exactly one short no-tools setup turn. Initial title/pin, rename with stable IDs/home, manual unpin across resume/reload, childless archive and retained marker/artifact hashes passed. The new contribution was disabled afterward; fixture home/history remain. This is evidence for that Dev runtime, not a claim that stable SDK 0.6.132 or every provider passed the same behavior. Global restart, managed-home retirement, workers, UI and automatic continuity/fallback remain outside that check.

## Storage behavior

Profile creation atomically records its first audit revision and an unbound logical main ID. Name changes preserve those IDs. Document writes (including SOUL.md) use expected per-record revisions; revision zero creates a new document. Stale edits fail instead of overwriting another writer. Revision history records author, reason and time; callers must supply truthful attribution. Markdown is retained verbatim, bounded to 65,536 characters per revision. No live file synchronization or automatic persona rewriting is performed.

Initial physical-thread binding is idempotent and exclusive. It cannot replace an already bound thread; a future verified continuity operation must own that transition. No ownership is inferred from thread titles or metadata. Creation validates public inputs and native thread ownership against persisted intent. Full checkpoints/export remain BOTS-16, and factory/storage initialization alone creates no homes or native conversations.

The focused suite uses real SQLite, independent connections for stale-write tests, rollback fault injection, SDK reload and a separate Node process reopening committed records. Tests pin better-sqlite3 13.0.3 for its packaged prebuilds under the repository's `--ignore-scripts` install policy; production continues to use the public host-owned database handle.

## Design documents

- [Product specification](docs/spec.md): experience, scope, configuration, conversations, tasks, and UI.
- [Memory and checkpoints](docs/memory.md): accrual, retrieval, revisions, forgetting, and dreaming.
- [Continuity](docs/continuity.md): compaction, handoffs, routing, model fallback, and lifecycle constraints.
- [Implementation plan](docs/plan.md): work breakdown, acceptance criteria, dependencies, and release gates.
- [Decisions and research](docs/decisions.md): conversation decisions, superseded proposals, reference evidence, and unknowns.
- [Review dispositions](docs/review.md): Fable findings and the resulting corrections.
- [Builder handoff](docs/handoff.md): ownership, release status, environment and next steps.
- [Public capability verification](docs/capabilities.md): current declarations, bounded runtime evidence and open support gates.
- [Capability follow-up](docs/capability-followup.md): queue/Stop regressions, native board routing and unmanaged home archive/restart evidence.
- [Native continuity admission gate](docs/sdk-continuity-gates.md): historical reproduction and deferred core prototype, outside the plugin development dependencies.
- [Continuity acceptance matrix](docs/continuity-matrix.md): evidence level, remaining Stop/override/recovery checks and concrete queue compatibility limits.
- [Minimum supported runtime](docs/support-boundary.md): existing manifest gates, distinct SDK/runtime floors and upgrade/rollback requirements.

The dedicated BB Tasks project is **Bots**, prefix **BOTS**, stable project ID `01M73NSQMGEYPWZ30WSR2CEYBP`. It is intentionally not linked in place of the repository's existing BBP tracker. Tasks are the source of implementation intent; keep them and these documents aligned as constraints are verified.
