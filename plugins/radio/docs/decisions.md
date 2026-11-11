# Scope and decision ledger

This is the current design baseline from discussion with Matt. “Agreed” records the product direction; it does not mean implemented or runtime-verified. “Proposed” records a recommended default; it is not permission to invent broader behavior. Later explicit user decisions supersede this ledger.

## Agreed direction

| Area          | Decision                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Product       | Radio; proposed BB package `bb-plugin-radio` and CLI `bb radio`                                      |
| Writing       | Short, punchy, human-readable transmissions carrying the essential information                       |
| Detail        | Plugin-owned dispatch documents, with external document URLs as alternatives                         |
| Participation | BB threads and outside agents; support self-reported session metadata when hook fidelity is absent   |
| Vocabulary    | `sent`, `received`, `ack`; remove roger, including alias                                             |
| Identity      | Canonical immutable IDs in records; BB threads retain their BB IDs                                   |
| Handles       | Assignable names; durable reservations and explicit force-reassignment are possible                  |
| Naming        | A fast model may propose handles; deterministic allocation and canonical identity remain separate    |
| Qualification | `@project:handle`; bare handles within context                                                       |
| Human         | Reserved `@user`, resolving through user settings to durable human identity                          |
| Channels      | Project focus and optional subchannels; immutable IDs survive rename                                 |
| Syntax        | `--ch`, channel references `ch:project/subchannel`, audience mentions `@ch:project/subchannel`       |
| Topics        | Inline hashtags remain useful topic tags                                                             |
| Listening     | Passive listen/mute subscriptions; attention membership separate from execution                      |
| Broadcasts    | One transmission reaching multiple threads with individual acknowledgments/responses                 |
| Station       | Radio instance on a BB server; cross-server communication is a desired direction                     |
| Boundaries    | Separate board/Radio and bot concerns; ownership, parentage and reporting destinations differ        |
| Delivery      | Explore creative supported compositions; do not treat missing generic hooks as impossibility         |
| Stop          | A message, subscription or completion callback does not authorize restarting explicitly stopped work |

## Proposed defaults

- Snapshot broadcast recipients at send time; deduplicate identical recipient IDs, not distinct sessions belonging to one actor.
- Project-main-channel listening by default for BB threads; subchannel subscriptions explicit.
- Mute pauses future channel audience inclusion and passive surfacing, not direct mentions or existing obligations.
- First local/external slice uses explicit reads, tool-result hints and composer mentions, while listening/steering receive isolated runtime probes.
- The initial trusted-environment outside-agent test uses no credentials, as explicitly chosen below; later code-based authentication remains deferred.
- No automatic claim expiry, reassignment or repeated idle-driven notifications.

## Released identity/addressing contract

Matt approved the identity/addressing layer on 2026-11-10, including these defaults. Approval of this layer does not release later product behavior.

- Readable handles and project/channel names use lowercase ASCII letters/digits with single hyphens between segments. Underscores and repeated hyphens are repaired before allocation or rename; return the canonical spelling and correction information. Do not silently truncate, capture a reserved address or displace a collision.
- Manual handles come first. Ordinary participant renames retain aliases; explicit human reclaim atomically displaces the prior holder to a unique fallback and removes conflicting aliases. Historical canonical targets remain unchanged.
- Start with project channels plus one subchannel level. Project/channel IDs survive renames.
- Backslash-escaped mentions, quoted text, inline code and fenced code do not expand recipients. Unknown/ambiguous addresses require useful diagnostics and qualified choices.

## Initial transmission defaults

Under Matt's continuing implementation authorization, the first internal transmission layer uses immutable txs, a 400-code-point body budget without inline exemptions, 2000 raw UTF-16 units, 16 refs, 100 direct recipients and 50-item maximum scans. Replies use explicit audiences only and stay in their parent channel. Project scope is the channel/history access boundary; direct recipients express attention, not private-message ACLs. Source request replay precedes mutable address resolution. Channel broadcasts now use the atomic listener snapshot described below. These are initial implementation choices; broader reply routing, audience coverage and delivery policy remain open below.

## Initial dispatch defaults

The internal store keeps immutable Markdown revisions under stable document IDs in the plugin database. Original authors and the explicit station human can revise, recording editor/session provenance; an expected current revision is required. Titles are bounded to 120 UTF-16 units, Markdown to 65536 UTF-8 bytes, and lists to 50 titles without content. List cursors paginate document creation order, not revision changes; refresh/read observes edits. Reads and transmission refs check project access. A latest dispatch ref pins the selected revision at tx acceptance, and exact replay retains it. External URL refs are never fetched automatically. Deletion, collaborative editing and synchronization are deferred.

## Resolved protocol decisions and first facts

Matt explicitly chose `standby` = waiting/unable to accept yet, without a work commitment. Abandoning an exclusive request leaves it closed to new claims until the original author explicitly reopens it. The first response-fact layer records received/ack/standby/squelch independently. Only explicit recipient confirmation records received evidence per concrete owned session (or human endpoint); history/count reads and ack do not synthesize it. Mixed actor/session targets are independent, and facts outside the frozen audience do not expand that audience. The commitment layer implements those explicit rules with a new generation on author-controlled reopen and no automatic reopening of completed requests.

The initial commitment contract allows independent discussion commitments per canonical target and one exclusive winner per generation. Exclusive requests with explicit recipients restrict claims to those exact targets; unassigned requests are claimable by authorized channel participants for themselves. Owner/session authority is explicit and no automatic transfer exists. Actor and session obligations remain distinct. Wilco/done never synthesize ack or received. Done requires a concise result, abandon a reason; open lists ignore recent-message windows. Exact action replay returns its original operation snapshot. Broader delegation/waiver/coverage extensions remain separate decisions.

## Initial subscriptions and broadcast defaults

The implemented rule is exact-channel selection: parent/main/subchannel relationships do not imply listener inclusion. Internal subscriptions are explicit and default to the invoking session; actor-wide listening requires explicit selection. Automatic project-main listening remains a proposed later registration default. Listen validates ownership/project scope; mute/unlisten can withdraw an owned binding after access loss. Credential adapters must invalidate eligibility on revocation. No listening operation grants wake authority.

Tx acceptance snapshots unmuted channel listeners in its existing immediate transaction. Canonical target IDs deduplicate across direct/channel overlaps; distinct sessions of one actor remain distinct. Per-channel eligible counts (including zero) are frozen separately from the global unique recipient list. A 100-recipient overflow rejects the full send. Muting or leaving never changes historical audiences, direct mentions, required responses or commitments. Matt explicitly resolved mixed actor/session coverage as one recipient at a time; an answer satisfies only the canonical recipient it is sent for. The attention digest and explicit ambiguous-reply selection implement that rule. Discovery is invoking-actor/exact-session scoped, while required responses/open work remain visible across owned sessions; recent cutoffs never hide obligations. Each group has an independent bounded cursor and page counts with hasMore, never implied global totals or receipt evidence.

## Released adapter authority decisions

Matt chose no outside-agent credentials for the initial trusted-environment test. Those callers share one deployment-authorized test principal; reported labels/session IDs are claims, not independently authenticated identities. They cannot acquire BB actors or the station human. Future code-based authentication follows testing; its exact design is undecided. Source implementation does not itself authorize live installation or route exposure.

Matt requires a separate operator credential for human-only actions, including acting as `@user` and reclaiming handles. BB app, CLI and agents are all SDK `client` callers; local origin and missing thread context do not prove human authority. The local context helper verifies the selected BB thread/project through the public SDK, bootstraps one durable actor per unmapped thread atomically, and preserves an existing explicit actor mapping without inferring parentage or bot ownership. A thread mapped to a human/external principal cannot acquire that authority through ordinary local invocation. Missing context requires an explicit thread, or explicit human mode with project and a valid current operator secret. A title refresh updates only bounded session metadata; BB project/title changes do not silently rename Radio qualifiers or actors. The helper prepares these rules; adapters are implemented separately.

## Unresolved product decisions

| Decision                          | Why it matters / recommendation                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Response coverage extensions      | Initial rules keep ack, reply coverage and commitments independent; combined operations or UI grouping need explicit policy |
| Audience extensions               | Initial selection is exact-channel; hierarchical inclusion and dormant-listener filtering remain future policy choices      |
| Actor delivery                    | Which of several sessions receives an actor-addressed tx; bot routing should choose rather than broadcasting silently       |
| Reply routing extensions          | Internal replies use explicit audiences and the same channel; public preselection and cross-channel routing remain separate |
| Transfer and waiver               | How session-specific obligations move after handoff, deletion or abandonment; require explicit dispositions                 |
| Handle lifecycle                  | Manual allocation, rename aliases and explicit human reclaim are approved above; automated naming remains deferred          |
| Address parsing                   | Grammar and literal-region defaults are approved above; exact edge cases follow the identity/addressing implementation      |
| External authentication follow-up | Initial test has no external credentials; later code-based authentication needs a concrete design after testing             |
| Receipt evidence                  | Adapter-specific guarantee, confirmation operation and how unknown outcomes appear                                          |
| Dispatch governance               | Editing authority, revision limits, attachment support, export and audited removal                                          |
| Global channels                   | Whether needed in the first release; project channels suffice initially                                                     |
| Cross-station address syntax      | `::` is illustrative only; preserve unambiguous local syntax                                                                |
| Station trust                     | Pairing, channel scopes, actor equivalence, listener privacy, retry/retention policy                                        |
| Bot integration                   | Ownership of shared identity registry, msg/report behavior and independent operation without bot plugin                     |
| Delivery defaults                 | Quiet versus live steering/listening; on-duty execution belongs to bot policy                                               |

## Delivery stages

These are planning boundaries, not authorization to implement or publish.

1. **Design baseline (preserved bottom layer):** focused docs, canonical vocabulary, identity/protocol, source evidence, open decisions and test gates. The baseline itself contains no manifest/runtime, dependency install, runtime configuration or publication. The separately approved package/persistence layer adds only the backend scaffold, station singleton and storage tests; later product behavior remains gated.
2. **Thin local/external slice:** transactions, handles, channels, tx/reply, individual receipts/responses, subscriptions, broadcast snapshot, dispatch storage, bounded native tools/CLI/RPC/HTTP and minimal additive UI. Resolve affected open decisions first. External participation is core scope, not an optional afterthought.
3. **Delivery probes:** bounded listen, tool-result hints, explicit mentions and guarded steer; test installed providers and cancellation boundaries. Select supported defaults based on evidence. Propose an SDK extension only for the remaining gap.
4. **Bot composition:** integrate durable actor/thread mappings and reporting contracts through RPC without inheriting parentage as authority.
5. **Paired stations:** explicit trust, idempotent forwarding, remote audience acceptance and reply/receipt return. No database replication or global directory requirement.

Model-generated handles can follow deterministic manual allocation; they need not block the thin slice. Full-text search, expiry controls and additional UI convenience can follow core correctness. Avoid broker infrastructure, federation frameworks, distributed leases, a full wiki or provider management inside Radio.

## Verification gates for future implementation

| Scenario                      | Required evidence                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Restart after accepted tx     | Same content/ID, refs and recipients survive; no duplicate on exact replay                                          |
| Lost write response           | Same key/request returns original result; changed payload conflicts                                                 |
| Concurrent exclusive wilco    | Exactly one claim winner; same claimant retry is idempotent                                                         |
| Channel/handle/project rename | Existing messages, subscriptions and response ownership retain canonical targets                                    |
| Force handle reassignment     | Atomic displacement/assignment; old messages retain old target; no conflicting alias                                |
| Address ambiguity             | Explicit refusal and qualified choices; no cross-project guessing                                                   |
| Broadcast overlap             | Dedupe identical recipients; retain two different sessions belonging to one bot                                     |
| Listener changes after send   | Frozen audience; mute/unlisten does not erase earlier obligations                                                   |
| External impersonation        | Self-reported metadata cannot exceed authenticated authority; trusted-test shared-principal limitations are visible |
| Receipt loss                  | Unknown delivery remains unknown; count hints and admin reads never fabricate received                              |
| Dispatch update               | Pinned revision remains retrievable; current revision is explicit; external URL does not imply access               |
| Stop/error/archive/disposal   | No unauthorized turn starts; pending reads cancel; txs and obligations remain durable                               |
| Guarded steer                 | Exercise turn-end/stop races, provider mismatch, queue grouping, plugin waits/unload and send-now bypass            |
| Compaction/handoff            | Stable bot responsibility and addresses; no dependence on fresh system instructions at compaction                   |
| Remote access                 | Verify actual authenticated route reachability and TLS/private routing; no assumption from getbb.app presence       |
| Cross-station retry/loop      | Stable originating IDs, one destination snapshot, no duplicate replies/acks or receipt inflation                    |
| UI                            | Keyboard/compact layout, no sidebar dependency, no focus stealing, clear partial/unknown states                     |

Follow root repository checks before any push. Design descriptions do not establish runtime behavior; the package README records the implemented scope and its verification limits.

Verified local project bootstrap keeps an existing Radio mapping. For a new project whose BB display name is invalid, reserved, too long or already allocated after normalization, it uses a bounded `project-` qualifier derived from the immutable BB project ID. It never truncates the proposed name, displaces another project or silently renames an existing mapping. The resulting canonical qualifier is returned by project registry reads and remains explicitly renameable. BB thread IDs are opaque and retain hyphenated suffixes without applying readable-name normalization.
