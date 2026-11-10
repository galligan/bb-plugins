# Decisions and research provenance

Source: the durable design discussion in BB thread `thr_cc23h4keqr`, “Explore sidebar and bots plugin,” on 2026-11-10. A convenience transcript is attached to BOTS-1; its displayed external Radio completion contains truncation, so the live thread and separately linked Radio report remain authoritative for that passage. This document captures the final direction after corrections; early alternatives below are not parallel implementation requirements.

## Decision trail

| Topic         | Final direction                                                                                                                       | Superseded or deferred                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Relationship  | Persistent collaborators first, multiple configurations                                                                               | Specialist collection later                                                           |
| Navigation    | Additive Bots surface, native chat and bot-specific thread contributions                                                              | Tobi-style sidebar takeover; companion sidebar later                                  |
| Conversations | One stable main entry plus independently owned worker/monitor conversations                                                           | Every conversation as a child of main                                                 |
| Routing       | Explicit reporting contracts; native BB messaging for v1                                                                              | Radio/default passive inbox and external messaging deferred explicitly by Matt        |
| Home          | Stable bot-ID directory on a chosen machine, outside repositories                                                                     | Main cwd inferred from current/associated project                                     |
| Naming        | Bots / bb-plugin-bbots / bbots; Bob, @Bob, → @Bob task                                                                                | Generic bots package/ID collision; plugins/bots was conversational shorthand          |
| Soul          | SOUL.md as deliberate revisioned Markdown; soul-building skill                                                                        | Persona rewritten by ordinary inference/dreaming                                      |
| Storage       | SQLite authoritative; revisions/checkpoints; JSON/Markdown portability                                                                | Git-authoritative editable files and automatic commits were explored, then superseded |
| Restore       | Restore selected profile/knowledge revisions as a new revision                                                                        | Rewinding task completion, routing or executed actions                                |
| Shared memory | Optional BB global/project memory integration                                                                                         | Requirement that BB memory be enabled; automatic two-way synchronization              |
| Tasks         | Create/use bot board if Tasks available, otherwise tasks.md; one authority                                                            | Silent fallback to a second board on transient outage                                 |
| Execution     | Main/fallback/worker model choices through native controls                                                                            | Unverified universal seamless cross-provider fallback                                 |
| Continuity    | Automatic compaction/handoff for main and workers, verified pickup                                                                    | User-managed successors; successful API call equated with recovery                    |
| Stop controls | Matt confirmed native per-thread Stop plus per-bot maintenance toggle; explicit reports use normal messaging and may wake a recipient | Bot-wide pause omitted from v1; confirmation does not release implementation          |
| Dreaming      | Bounded idle summaries and separate consolidation with evidence and stop policy                                                       | Unlimited autonomous background work or facts invented from repeated summaries        |

## Reference evidence and its limits

Research previously inspected these examples; re-check current declarations before copying any calls. These are patterns, not runtime dependencies or proof of complete behavior.

- [Tobi bots sidebar](https://github.com/tobi/bb-bots-sidebar), local `repos/tobi--bb-bots-sidebar`: persistent identity, memory and cross-project ownership; header/Info association independent of the sidebar; CLI routing precedent. Avoid taking over navigation.
- [Prakash Bots](https://github.com/prakashchokalingam/bb-plugin-bots): additive Bots navigation rather than mandatory sidebar replacement. Earlier inspection checked frontend registration, not installed compatibility.
- [Personas](https://github.com/olsonjeffery/bb-plugin-personas): reusable persona/default patterns; specialists deferred.
- [Letta Agents](https://github.com/steveafrost/bb-plugin-letta-agents): externally hosted identity pattern; external runtime is not required here.
- [Bot Companions](https://github.com/ElijahFitzgeraldTuttle/bb-plugin-bot-companions) and [Companion Chat](https://github.com/divyesh-puri/bb-plugin-companion-chat): presentation versus identity, and host-native side conversations.
- [Duet guide](https://support.claude.com/en/articles/17631495-get-started-with-claude-duet) and [Dots tasks/memory](https://learn.chatgpt.com/docs/dots/tasks-and-memory): experience references for a persistent relationship, focused work, selected context and reporting. Public descriptions do not establish their internal compaction implementation.
- Aside memory was a user experience inspiration for simple, effective memory. Its actual storage/accrual implementation was not established by this discussion; do not claim it was reverse-engineered.
- [Auto Compact](https://github.com/Dummy-pixel-hash/bb-plugin-auto-compact): idle/failed boundary thresholds, cooldown and in-flight guards; no measured-effect verification or bot obligation preservation established.
- [Auto Compact Hermes fork](https://github.com/entin-hun/bb-plugin-auto-compact): bounded excerpts/latest output and same-environment successor; risk of omitted decisions and ancestry coupling.
- [Handoff](https://github.com/vburojevic/bb-plugin-handoff), local `repos/vburojevic--bb-plugin-handoff`: provider-independent transcript/briefing and pickup receipt. In-memory pending checks do not survive reload; nonempty first response is weaker than verified assignment recovery. Very large transcript transfer can recreate context pressure.

The Auto Compact references are registered in the existing modified `repos.json`. No reference plugin was installed or live-triggered by this exploration.

The separate Radio exploration (`thr_7wf8unnws2`) inspected BB 0.49.0 / public SDK 0.6.132 and reported that idle lacks causal stop/completion intent, live provider sessions can retain construction-time instructions, and dispatch hooks cannot append a completion-time inbox check. Its artifact is `/Users/mg/.bb/thread-storage/thr_7wf8unnws2/message-board-research.md`. Treat these as dated evidence requiring revalidation; Radio is not an implementation dependency. Do not use idle → send as a workaround for missing lifecycle support.

## Open questions that gate implementation

1. First choose native compaction, in-thread clear/re-brief, or a necessary successor from current public evidence. Verify fresh usage, queue reconciliation, stale predecessor input, child notifications, native navigation and drafts, and months-long event-history scalability.
2. Durable bot-home lifecycle with existing environment providers and which host/personal BB project contains the main thread (thread creation may require projectId even though the bot has no repository associations).
3. Tasks public RPC/navigation surface, creation reconciliation and collision-safe board prefixes; BB memory optional discovery/retrieval surface.
4. Stop intent, scheduling, cancellation and bounded maintenance execution for dreaming; do not infer consent from idle.
5. Provider-specific fallback classification and safe preservation of permissions/context.
6. CLI command collisions across plugins, exact header/context/Info/panel components, instruction/tool/skill binding boundaries, title regeneration, dispatch hold, SDK test fakes and coexistence with installed lifecycle plugins.

The builder records answers with declaration/source references and focused runtime evidence. A missing capability narrows advertised support or produces a separately scoped SDK request; it does not authorize editing BB core or silently dropping a central requirement.
