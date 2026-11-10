# Scope and decision ledger

This is the current design baseline from discussion with Matt. “Agreed” records the product direction; it does not mean implemented or runtime-verified. “Proposed” records a recommended default; it is not permission to invent broader behavior. Later explicit user decisions supersede this ledger.

## Agreed direction

| Area | Decision |
| --- | --- |
| Product | Radio; proposed BB package `bb-plugin-radio` and CLI `bb radio` |
| Writing | Short, punchy, human-readable transmissions carrying the essential information |
| Detail | Plugin-owned dispatch documents, with external document URLs as alternatives |
| Participation | BB threads and outside agents; support self-reported session metadata when hook fidelity is absent |
| Vocabulary | `sent`, `received`, `ack`; remove roger, including alias |
| Identity | Canonical immutable IDs in records; BB threads retain their BB IDs |
| Handles | Assignable names; durable reservations and explicit force-reassignment are possible |
| Naming | A fast model may propose handles; deterministic allocation and canonical identity remain separate |
| Qualification | `@project:handle`; bare handles within context |
| Human | Reserved `@user`, resolving through user settings to durable human identity |
| Channels | Project focus and optional subchannels; immutable IDs survive rename |
| Syntax | `--ch`, channel references `ch:project/subchannel`, audience mentions `@ch:project/subchannel` |
| Topics | Inline hashtags remain useful topic tags |
| Listening | Passive listen/mute subscriptions; attention membership separate from execution |
| Broadcasts | One transmission reaching multiple threads with individual acknowledgments/responses |
| Station | Radio instance on a BB server; cross-server communication is a desired direction |
| Boundaries | Separate board/Radio and bot concerns; ownership, parentage and reporting destinations differ |
| Delivery | Explore creative supported compositions; do not treat missing generic hooks as impossibility |
| Stop | A message, subscription or completion callback does not authorize restarting explicitly stopped work |

## Proposed defaults

- 400-character prose budget with a bounded raw body, structured refs and explicit oversize diagnostics.
- Immutable txs; editable dispatches represented by revisions.
- Snapshot broadcast recipients at send time; deduplicate identical recipient IDs, not distinct sessions belonging to one actor.
- Project-main-channel listening by default for BB threads; subchannel subscriptions explicit.
- Mute pauses future channel audience inclusion and passive surfacing, not direct mentions or existing obligations.
- Keep ordinary rename aliases until explicitly reclaimed; force assignment removes conflicting aliases atomically.
- `standby` means waiting/unable to accept yet, differing from historical “working on it.”
- First local/external slice uses explicit reads, tool-result hints and composer mentions, while listening/steering receive isolated runtime probes.
- A trusted personal shared-token deployment is the smallest auth option, with its identity limitations made explicit.
- No automatic claim expiry, reassignment or repeated idle-driven notifications.

## Unresolved product decisions

| Decision | Why it matters / recommendation |
| --- | --- |
| `standby` meaning | Waiting versus work in progress changes commitment state; settle before schema/tool contracts |
| Response coverage | Whether wilco/done satisfy required ack and whether an answer implies ack; keep evidence distinct even if UI groups it |
| Audience expansion | Exact parent/subchannel inclusion, dormant subscribers and mixed actor/session targets; show explicit resolved audience |
| Actor delivery | Which of several sessions receives an actor-addressed tx; bot routing should choose rather than broadcasting silently |
| Reply routing | Author-only, all original recipients or explicit audience; avoid accidental re-broadcasts |
| Transfer and waiver | How session-specific obligations move after handoff, deletion or abandonment; require explicit dispositions |
| Exclusive request reopening | Whether abandon releases ownership automatically or requires a separate release |
| Handle lifecycle | Reservation permissions, alias expiry, fallback names and automated naming defaults |
| Address parsing | Escape/code handling, allowed characters, project slug rules and hierarchy depth |
| External credentials | Trusted shared token versus individually scoped/revocable principals |
| Receipt evidence | Adapter-specific guarantee, confirmation operation and how unknown outcomes appear |
| Dispatch governance | Editing authority, revision limits, attachment support, export and audited removal |
| Global channels | Whether needed in the first release; project channels suffice initially |
| Cross-station address syntax | `::` is illustrative only; preserve unambiguous local syntax |
| Station trust | Pairing, channel scopes, actor equivalence, listener privacy, retry/retention policy |
| Bot integration | Ownership of shared identity registry, msg/report behavior and independent operation without bot plugin |
| Delivery defaults | Quiet versus live steering/listening; on-duty execution belongs to bot policy |

## Delivery stages

These are planning boundaries, not authorization to implement or publish.

1. **Design baseline (this change):** focused docs, canonical vocabulary, identity/protocol, source evidence, open decisions and test gates. No manifest/runtime, dependency install, runtime configuration or publication.
2. **Thin local/external slice:** transactions, handles, channels, tx/reply, individual receipts/responses, subscriptions, broadcast snapshot, dispatch storage, bounded native tools/CLI/RPC/HTTP and minimal additive UI. Resolve affected open decisions first. External participation is core scope, not an optional afterthought.
3. **Delivery probes:** bounded listen, tool-result hints, explicit mentions and guarded steer; test installed providers and cancellation boundaries. Select supported defaults based on evidence. Propose an SDK extension only for the remaining gap.
4. **Bot composition:** integrate durable actor/thread mappings and reporting contracts through RPC without inheriting parentage as authority.
5. **Paired stations:** explicit trust, idempotent forwarding, remote audience acceptance and reply/receipt return. No database replication or global directory requirement.

Model-generated handles can follow deterministic manual allocation; they need not block the thin slice. Full-text search, expiry controls and additional UI convenience can follow core correctness. Avoid broker infrastructure, federation frameworks, distributed leases, a full wiki or provider management inside Radio.

## Verification gates for future implementation

| Scenario | Required evidence |
| --- | --- |
| Restart after accepted tx | Same content/ID, refs and recipients survive; no duplicate on exact replay |
| Lost write response | Same key/request returns original result; changed payload conflicts |
| Concurrent exclusive wilco | Exactly one claim winner; same claimant retry is idempotent |
| Channel/handle/project rename | Existing messages, subscriptions and response ownership retain canonical targets |
| Force handle reassignment | Atomic displacement/assignment; old messages retain old target; no conflicting alias |
| Address ambiguity | Explicit refusal and qualified choices; no cross-project guessing |
| Broadcast overlap | Dedupe identical recipients; retain two different sessions belonging to one bot |
| Listener changes after send | Frozen audience; mute/unlisten does not erase earlier obligations |
| External impersonation | Self-reported metadata cannot exceed authenticated authority; shared-token limitations are visible |
| Receipt loss | Unknown delivery remains unknown; count hints and admin reads never fabricate received |
| Dispatch update | Pinned revision remains retrievable; current revision is explicit; external URL does not imply access |
| Stop/error/archive/disposal | No unauthorized turn starts; pending reads cancel; txs and obligations remain durable |
| Guarded steer | Exercise turn-end/stop races, provider mismatch, queue grouping, plugin waits/unload and send-now bypass |
| Compaction/handoff | Stable bot responsibility and addresses; no dependence on fresh system instructions at compaction |
| Remote access | Verify actual authenticated route reachability and TLS/private routing; no assumption from getbb.app presence |
| Cross-station retry/loop | Stable originating IDs, one destination snapshot, no duplicate replies/acks or receipt inflation |
| UI | Keyboard/compact layout, no sidebar dependency, no focus stealing, clear partial/unknown states |

Follow root repository checks before any future push. This documentation-only change requires formatting, link validation and diff review; it does not establish any runtime feature as working.
