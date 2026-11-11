# Bots product specification

Status: implementation contract, assembled from the design discussion on 2026-11-10. Matt explicitly released the builder on 2026-11-10; plugin development proceeds independently of deferred core work; BOTS-3 gates only affected support claims. Read [decisions](decisions.md) for provenance and [plan](plan.md) for capability gates.

## Outcome

A bot is a persistent collaborator that Matt can talk to for months across projects. Opening it returns to one stable ongoing conversation. Compaction and replacement sessions are first-class lifecycle work: Matt should not prepare handoffs, find replacement thread IDs, reconnect workers, or repeat context. Focused work can happen in other conversations owned by the same bot without flooding the main conversation.

The defining acceptance scenario is: create Bob, discuss a project, delegate an investigation and a monitor, make a decision in one worker, continue through compaction or handoff, and return later to the same collaborator with the decision, commitments, reports, and original evidence available.

## Scope and identity

- Display name: **Bots**. Package: `bb-plugin-bbots`. Plugin ID: `bbots`. Proposed CLI namespace: `bb bot`, subject to collision verification.
- Support multiple independently configured bots. Start with `Bob`; an avatar and richer identity can be developed later. Persistent collaborators come before a specialist catalog.
- A stable bot ID survives renames, model changes, and physical session replacement.
- Bot ownership, BB parentage, and reporting relationships are independent. Shared identity does not imply shared working context or automatic awareness of every event.
- The plugin works with any selected sidebar. A custom sidebar, Radio integration, external messages, webhooks, Slack identities, and a general channel framework are deferred.

## Configuration and soul

The BOTS-6 creation slice includes the minimal revisioned starter SOUL and construction callback, moved forward from BOTS-7 to ensure the first native session is owned and instructed. Full soul editing, model/permission controls and applied-revision presentation remain BOTS-7.

Each bot has a stable identity, name/appearance, soul document, execution defaults, default machine/home, project associations, task-source association, and conversation references. Use native provider/model controls, including supported reasoning settings.

Execution choices include a main model, a fallback model, and a working-thread model that initially inherits the main model. Main and worker permission modes use the native permission picker and initially inherit BB defaults; fallback never broadens permissions. Do not assume fallback is merely swapping a string: same-provider and cross-provider behavior must be verified and recorded in the continuity support matrix. Failure-trigger rules belong in [continuity](continuity.md).

`SOUL.md` is the named, readable and editable Markdown persona document, stored with revisions in SQLite. It describes communication, values, judgment, initiative, disagreement, and collaboration. It is supplied when each bot-owned provider session is constructed. Existing live sessions can retain their construction-time instructions; edits and restores are pending until the next verified session construction or supported refresh. Show applied versus current revision, and do not silently reset a session merely to apply a soul edit. It is not an independently writable live file synchronized with the database; export/materialization must be explicit.

Ship a soul-building skill for conversational creation and refinement. It asks enough to establish useful behavior, proposes concise changes for review, and avoids inventing an elaborate personality. Ordinary memory accrual and dreaming do not silently rewrite the soul. Explicit soul edits are deliberate, revisioned operations.

Project association modes are selected projects, all projects (including future additions), or no association. Multiple bots may share projects. Association aids responsibility and workspace selection; it does not adopt all existing threads, load every repository's instructions into the main conversation, or extend permissions.

## Bot home and environments

The main conversation runs in a persistent bot home outside repositories, on a configured machine, keyed by stable bot ID. Renaming does not move it. Keep durable configuration/memory in plugin storage, distinct from notes, drafts, downloads, and scripts in the home.

| Conversation              | Workspace default                                       |
| ------------------------- | ------------------------------------------------------- |
| Main                      | Persistent bot home                                     |
| General planning/research | Home, optionally a dedicated artifact folder            |
| Repository work           | Associated project's checkout or isolated worktree      |
| Multi-thread monitoring   | Home; inspect target environments on their actual hosts |

A project association must not relocate the main conversation. Do not assume automatic file synchronization across machines. Verify existing environment-provider persistence and archive/retirement behavior before choosing the physical path. Never auto-delete a bot home or its artifacts when a session is replaced. Offline host or missing home is an explicit recoverable state, not permission to silently recreate an empty collaborator.

## Conversations and reporting contracts

The main thread title is `@<bot>`; bot-created working threads use `→ @<bot> <task>`, including independently parented threads. Store ownership explicitly. Plugin code establishes naming and initial pinning; respect later manual unpinning. A bot rename updates its managed names without changing identity. Set managed titles at creation and bot rename; do not continuously fight manual thread renames. A successor inherits the current pin preference rather than always pinning itself.

In v1, a working conversation is a normal BB thread, either a child of a relevant work thread or independent. Integration with BB side-chat forks is deferred; do not claim a side-chat fork is automatically a managed bot conversation. A monitor watching several unrelated threads should not have to become a child of the main bot thread. Each has its own selected context and assignment. Users can enter these threads, ask follow-ups, and redirect work.

Each reporting contract records responsibility, source/target references, relevant context, report triggers, destination, report content expectations, stop conditions, and reassignment. Use sensible defaults inferred from the request, with a visible editable summary rather than a mandatory form. Reports can go to another monitor/coordinator instead of the main conversation. Meaningful decisions made inside a worker propagate according to its contract; a shared memory write alone is not delivery. The worker agent evaluates human-readable report triggers and stop conditions, reinforced by the operating skill; v1 has no plugin-side trigger/subscription engine. Plugin code validates ownership and resolves routing. Bot-created children default to native parent notifications off, since explicit contract reports are authoritative; expose a deliberate override and warn against duplicate notification paths.

Initial messaging uses native BB thread messaging only:

- `bb bot msg "…"`: resolve calling thread → owning bot → current main conversation; explicit bot selection is required for an unowned caller.
- `bb bot report "…"`: resolve the caller's reporting contract; never silently substitute the main conversation if a contract is missing or ambiguous.
- Preserve source attribution and reply destination. Use the native queue-if-active send mode by default rather than steering an active task. An idle recipient may start a new turn; this is native messaging, not a passive inbox. Return acceptance/queue evidence without pretending it proves reading, completion, or a response. Do not wait synchronously for a reply.
- Resolve stable logical destinations at dispatch, including after handoff. Preserve messages arriving during transitions as described in [continuity](continuity.md).

## Tasks and operating skill

When BB Tasks is available, setup should offer to create a dedicated tracker board named for the bot or use an existing board. Save the stable tracker ID, not a display name or BB project ID. Board scope is independent of project associations. Verify supported Tasks integration and board-opening APIs rather than assuming CLI functionality means a public RPC exists.

When Tasks is absent at initial setup, initialize `tasks.md` in the bot home. Maintain one authoritative task source. Temporary loss of a configured Tasks board is an unavailable state, not an automatic switch to Markdown. Do not implement automated migration in v1. An explicit user-directed migration is an agent-assisted operation that preserves the old source and records links/mapping before changing authority. In Markdown mode, writes are serialized on the home host through a host entry/CLI operation; workers on other machines report through that path or the main conversation, never edit an assumed local copy. UI links to tasks.md rather than parsing arbitrary Markdown into authoritative task counts.

Ship an operating skill included in every bot-owned session. Wire one synchronous agent-configuration callback and an operating-skill skeleton with models/soul before creating workers, then extend its guidance as features land. Record authoritative conversation ownership before first session construction; spawn metadata may carry a lookup ID but is only a mirror checked against SQLite. Native threads spawned outside the Bots interface are not automatically adopted. It reinforces: read soul; retrieve relevant memories; check commitments/task source; record new commitments; update milestones and blockers; close completed work; create workers with context and contracts; report through native messaging; preserve state for continuity. Skills support behavior; lifecycle invariants, mappings, naming, and persistence belong in code.

Commitments identify what is owed, owner logical conversation, authoritative task reference, and supporting evidence. When linked to a task, status is read from that task source; only an unlinked commitment owns its own open/closed state. They are a small continuity record, not a second competing task board. Resolve task detail from the configured source and reconcile references rather than silently duplicating its status authority.

## Supported runtime

The development skeleton uses existing released BB 0.49.0 / public SDK 0.6.132 contracts, with manifest `engines.bb >=0.49.0`, `engines.bbPluginSdk >=0.6.132`, and exact build dependency 0.6.138, the repository pin. These are package compatibility minima, not certification of every planned capability. Matt chose minimum-version support rather than arbitrary downgrade compatibility, then explicitly removed maintainer changes as a development prerequisite. Proposed SDK 0.6.139 is not required or claimed released. See [support boundary](support-boundary.md) for feature gates and the distinct, deferred core-prototype data caveat. No production installation is authorized.

## Stop and background activity

Confirmed by Matt: v1 uses native per-thread Stop plus a persistent per-bot background-maintenance toggle, with no new bot-wide Pause command. The separate implementation release is recorded in the handoff.

Native Stop interrupts that thread's current work; Bots must not automatically retry that stopped assignment, run pickup/re-brief on its behalf, or start maintenance because it became idle. Preserve this restriction until a new user-authorized dispatch. Turning background maintenance off prevents new idle summary/dream runs and cancels an in-flight maintenance run at a safe supported boundary without partial writes. It does not stop ordinary user-directed conversations or cancel independent workers. Default automatic maintenance off until capability and cost policy are verified. Bots controls only its own scheduled work and recovery; native Stop is not a universal veto over other plugins. Never disable another plugin to make a support claim. If safe automation is unavailable, show the limitation and offer a supported explicit action.

An agent-authored `msg`, `report` or `reply` is a new explicit communication, not a passive inbox entry: queue-if-active may start a new recipient turn when idle, including after a native Stop. Receiving a report must not resume the previously canceled assignment. This is an operating-skill and report-framing requirement, verified by a bounded smoke test, not a guarantee plugin code can enforce against arbitrary model behavior. State this behavior in command/UI help. If Matt chooses a durable bot-wide hold instead, define its message retention, worker cancellation and resume semantics as a separate design revision before implementing it.

## Agent interface

Choose CLI-first so every provider has the same small interface even when its tool set is fixed for a live session. Exact flag grammar is established during implementation; the following are required operation families, not a license for a general command framework:

| Operation                                           | Responsibility                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bb bot soul show/update`                           | Inspect or deliberately revise SOUL.md with expected revision and explicit user instruction/approval; never an autonomous inference |
| `bb bot show` / `brief`                             | Resolve caller or explicit bot; bounded current soul revision, contract, commitments, task source and relevant memory references    |
| `bb bot work`                                       | Create an owned normal BB working thread with selected environment/model, assignment and contract                                   |
| `bb bot msg` / `report` / `reply`                   | Contact current main, contract destination, or an explicit logical conversation/reply source                                        |
| `bb bot contract show/update`                       | Inspect or deliberately change assignment and reporting agreement                                                                   |
| `bb bot memory search/show/remember/correct/forget` | Bounded retrieval and provenance/revision-checked writes                                                                            |
| `bb bot commitment list/add/close`                  | Maintain unlinked obligations or resolve/update their authoritative task references                                                 |
| `bb bot capture`                                    | Record in-turn recent state and source boundaries without starting another agent turn                                               |
| `bb bot checkpoint create/list/restore`             | Capture or restore profile/knowledge revisions under explicit user instruction/approval, never operational actions                  |

Validate bot/ownership/destination at each boundary; bound output; use expected revision per record. Do not infer trust or ownership from writable thread metadata, a title, or an arbitrary command argument. An explicit bot selector identifies the target but does not grant new host permissions.

## Additive UI

Follow the repository's [UI/UX guidance](../../../docs/dev/ui-ux.md). Reuse native chat/composer, model pickers, registered panels, routing, and registry controls. Preserve host stop controls, queue/steer behavior, draft/attachment state, thread menus, theme, focus, and compact layouts.

| Surface               | Purpose                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------- |
| Bots navigation panel | Create/list/manage bots; open ongoing chat; edit soul/settings/projects; inspect memory and checkpoints |
| Thread header         | Compact identity button; open bot panel; return to main from a worker                                   |
| Context card          | Main: task/worker summary. Worker: assignment, linked task, reporting destination and trigger           |
| Registered side panel | Tasks, active workers, current commitments beside the conversation                                      |
| Thread Info           | Ownership, main/working role, actual environment, model, configuration/checkpoint links                 |
| Overflow actions      | Edit soul, model settings, memory; avoid duplicating all settings everywhere                            |

Only show bot-specific contributions on bot-owned threads. Keep routine compaction quiet; a longer transition can show “Bob is continuing…” without losing input. Expose actionable recovery failures and history links without permanent diagnostic clutter. Clicking Bob navigates to its native current main thread using host routing, preserving header, Info, panels and drafts. Do not embed a second chat surface in the Bots panel in v1. A minimal list/create/open panel and identity header land with the initial Bob flow, before the later management surfaces.

## Out-of-box flow and release acceptance

Creation establishes identity, initial soul, selected model defaults, persistent home, task source, and named/pinned main conversation. Opening an existing bot resumes its logical main conversation. Setup operations must survive interrupted creation without leaving duplicate homes, boards, or main sessions; preserve partial progress and explain how to resume.

Verify at least two bots remain isolated, selected/all/no-project modes work, renames preserve references, worker parentage can vary, reports reach non-main destinations, task-source outages do not fork authority, and basic use works with BB memory disabled. Verify sidebar independence in the running host, not just source code. Full release also requires memory and continuity acceptance in their companion documents; these are not optional polish.
