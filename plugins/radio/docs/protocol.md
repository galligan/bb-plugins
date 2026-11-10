# Communication protocol

The internal transmission/reply store described below is implemented. Explicit recipient confirmation, ack, standby and squelch facts are also implemented internally. Commitments/claims are implemented internally; subscriptions and delivery remain planned; no public communication APIs are available yet. [Open decisions](decisions.md) identify semantics that still need agreement.

## Transmissions

A transmission has an immutable ID, author actor, optional acting session, channel ID, body, timestamp, structured refs/tags, optional reply parent and explicit audience. It can have no recipient. A correction is a new tx referring to the original; historical content is not silently edited.

Create the tx, resolved references and local recipient snapshot in one transaction. An author/principal-scoped idempotency key binds the canonical request. Repeating the same request returns the original result; reusing the key with different input conflicts. Return `sent` only after durable acceptance. A lost response is an unknown outcome to the client until exact replay/lookup confirms it, not grounds for a new logical send.

Replies are new txs linked to an existing accessible parent. Repeated replies use the same idempotency rules. Replying does not automatically acknowledge, commit or complete; an operation may explicitly combine a reply with one of those actions atomically. Cross-channel replies must not expose private parent content or invent access. The initial internal store uses explicit recipients only: replies inherit no audience and must stay in the parent channel. Broader reply-routing policies remain open.

## Implemented transmission limits and access

The first store uses a 1–400 Unicode-code-point body budget with no inline exemptions and a 2000 UTF-16-code-unit raw cap. References live outside the body: at most 16 HTTP(S) URLs without embedded credentials or canonical local transmission/participant/channel/dispatch refs. At most 100 direct recipients are accepted after deduplication, with an independent cap of 1000 raw recipient-ID entries. A quoted/code/escaped mention stays literal. `ch:` freezes a channel reference only; `@ch:` is rejected until the subscription layer can create the listener snapshot. A dispatch ref with no revision selects latest at acceptance and stores the resulting pinned revision; retry replays the original pin. Dispatch reads still enforce project access. No URL fetch or delivery happens on acceptance.

Adapters supply authenticated caller, author, optional acting session and authorized project IDs separately from request fields. The author must belong to that caller and the session to that author. Project scope controls channel/history access; recipients are attention targets, not a private-message ACL. Structured local refs and reply parents must be accessible at creation. Participant IDs supplied explicitly require a handle in an accessible project (or their owning actor's handle); the station human remains globally addressable. A reference does not confer access to its target content on a future reader.

Idempotency binds validated source content, channel, refs, deduplicated/sorted explicit recipient IDs, reply parent and acting session, within the authenticated author/principal namespace. Lookup precedes mutable handle resolution; replay returns the persisted result without retargeting after rename/reclaim. Replays still require author and posting-channel access. New sends resolve all body addresses and refs, then persist content, tokens, tags and recipients in one immediate SQLite transaction. Unknown/ambiguous/malformed input and failed recipient writes leave no accepted key. Reads never mark receipt. Channel scans use a monotonic server cursor with a 1–50 item limit (20 by default), `nextCursor` and `hasMore`; cursors do not depend on timestamps.

## Receipt and response facts

These facts are not a single global status enum or mandatory progression. They apply to distinct relationships and evidence.

| Fact       | Recorded by                                | Meaning                                                                    |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `sent`     | Radio                                      | Transmission durably accepted                                              |
| `received` | Delivery adapter or recipient confirmation | Actual tx content reached a particular recipient session/client            |
| `ack`      | Participant                                | Explicit confirmation of receipt and understanding, without a work promise |
| `wilco`    | Participant                                | Acceptance of responsibility; opens a commitment                           |
| `standby`  | Participant                                | Waiting/unable to accept yet; no work commitment                           |
| `squelch`  | Participant                                | Dismiss from that participant's attention view                             |
| `done`     | Commitment owner                           | Close a commitment with a result/proof                                     |
| `abandon`  | Commitment owner                           | Close without success, with a reason                                       |

`roger` is removed, including aliases. Do not expose automatic storage/delivery as `ack`. A count hint or preview that omits the body is not `received`. An explicit ack is participant evidence even if an automatic receipt was missed; retain its provenance rather than inventing an earlier delivery timestamp.

Sending bytes or accepting a BB dispatch is not by itself proof of session receipt. Each adapter must define its observable evidence. External clients can automatically confirm received IDs through an idempotent operation. Lost confirmations leave receipt unconfirmed. “Received” does not prove the model attended to or understood the content.

Separate content retrieval from recording a recipient receipt. History/search/admin reads must not accidentally mark another participant's inbox received. A participant inbox operation can combine retrieval and confirmation only when its contract and transport evidence support that claim. Displaying a message to Matt does not mark a bot as having received it.

Keep receipt evidence per session/endpoint, even when addressing an actor. A bot-wide read summary must not hide unresolved commitments from its other sessions. Reply existence is derived from linked txs and author identity, not conflated with ack or completion. No literal `read`/`seen` product state is required in the initial vocabulary; future UI read cursors would be separate from receipt and obligations.

## Implemented response-fact contract

`responses.record` accepts one explicit `received`, `ack`, `standby` (optional reason) or `squelch` fact, with tx ID, canonical target ID and scoped idempotency key. The authenticated invoking actor can act for itself or its exact acting session; another session owned by that actor remains a separate target. Actor receipt requires a concrete owned session, while human confirmation may use the human endpoint. Received events carry `recipient-confirmation` provenance, never a client-supplied claim of transport evidence. Reconfirming the same tx/target/endpoint returns its original event without inflating the count. Changed key input conflicts and failed writes roll back event, receipt and key together.

Ordinary reads and summary/history calls never confirm receipt; ack also never synthesizes receipt. Authorized channel participants may record facts for themselves even outside the frozen audience; that does not add a recipient or change its denominator. Summaries cover the exact frozen target IDs. Actor/session responses cover only their exact target; there is no implicit mixed-target coverage. Standby records waiting with no commitment, and squelch never closes responsibility or waives required responses. Events retain actor/session/timestamp provenance through reopen and are available in project-authorized cursor pages of at most 50. Commitment operations are separate from these response facts; no execution/wake is implied.

## Commitments and claims

A commitment records its owner actor or specifically addressed session, originating tx, acting-session provenance, opening event and eventual closure. `done` requires a concise result or accessible evidence ref. `abandon` requires a reason. Closure does not erase the original tx or another participant's commitment.

Matt resolved `standby` as waiting/not ready to accept, with a reason or checkpoint where useful; it does not open a work commitment. `standby` and `squelch` do not implicitly close an existing commitment.

Distinguish ordinary discussion from explicitly exclusive work requests. Multiple participants may independently commit to discussion or nonexclusive work. For an exclusive unassigned request, `wilco` can atomically claim the request and open the commitment; concurrent callers yield one winner, with idempotent replay for that winner. Matt resolved abandonment to leave an exclusive request closed to new claims until its original author explicitly reopens it; no automatic reopening is allowed.

No automatic lease expiry, silent takeover or stale-success inference. Stalled responsibilities stay visible. Explicit delegation/waiver records who changed the owner or required response; actor aliases alone do not grant authority. General task scheduling belongs outside Radio.

## Implemented commitments and claims

`commitments.act` accepts `wilco` for the invoking actor or exact acting session, `done` with a 1–400 UTF-16-unit result, `abandon` with a bounded nonblank reason, and original-author `reopen` with the expected abandoned commitment ID. Actor ownership and acting sessions are authenticated separately from request input. Ordinary discussion allows one commitment per tx/target, independently of others. For an exclusive request, one immediate SQLite transaction claims the current generation; overlapping callers yield one winner. Explicitly addressed exclusive requests restrict claims to those exact frozen target IDs. An unassigned request allows any authenticated participant with channel access to claim for its own actor/session. Claims do not expand the frozen recipient denominator.

Abandon retains the closed exclusive claim until the original tx author explicitly reopens it. Reopen requires the expected current abandoned commitment, increments generation and records an immutable event; a new claimant receives a new commitment, preserving old closures. A completed exclusive request cannot reopen. A closed discussion commitment needs a new tx for new work. Every action records actor/session provenance and atomically binds its exact replay result with its state change/event. Replaying an old wilco after closure returns the original open-operation snapshot; a separate authorized read returns current state. Changed key payload conflicts. Failed writes roll back ownership, generation, commitment and event together.

Actor-owned commitments remain available to a later owned session. Session-specific commitments require that exact session, with no automatic transfer on session end. Bounded owner/project-scoped open lists have no recent-message cutoff; event history uses monotonic cursors. Standby/squelch never close responsibility, and neither wilco nor done synthesizes ack/receipt. `requireAck` and `expectReply` are distinct explicit transmission expectations, defaulting to false. New request fields omit default values from the canonical replay encoding so already-stored requests still replay through the appended schema upgrade. Broader delegation/waiver policy remains deferred.

## Listening and muting

A subscription binds a canonical participant/session ID to a canonical channel ID. For BB CLI/tool calls the invoking thread is the default session. External callers use their authenticated/session context. Actor-wide subscriptions require explicit intent rather than being inferred from thread ownership.

- `listen`: include channel activity in passive discovery and make the subscriber eligible for future channel broadcasts.
- `mute`: pause passive surfacing and future channel-broadcast eligibility, preserving the subscription and history.
- `unlisten`: remove the subscription.
- `listening`: list current subscriptions and mute state.

A direct participant mention is separate from a muted channel. Muting/unlistening does not remove recipients from existing broadcasts, waive required acks/replies, or abandon commitments. Previously selected audience records remain inspectable. Exact mute duration controls are deferred.

Proposed default: a BB thread listens to its project's main channel; subchannels are explicit. A subchannel subscription does not implicitly subscribe to siblings. Whether a project-wide broadcast includes descendant-channel listeners needs a precise selection rule before implementation. Show the resolved audience rather than assuming hierarchy implies inclusion.

Listening grants relevance, not permission to wake a session. A listener may be idle, stopped, disconnected or lacking hooks. See [delivery](delivery.md).

## Broadcasts

A broadcast is one immutable tx plus a recipient snapshot. `@ch:payments/cutover` resolves the channel ID, selects authorized eligible listeners at send time, and deduplicates overlapping mentions by canonical recipient ID. Freeze the list so “3 of 5 acknowledged” has a stable denominator. Joining later does not create a retroactive obligation; adding recipients later is explicit and audited.

Recipient mode matters:

- Actor-addressed: an authorized session can respond on behalf of that actor; preserve which session acted.
- Session-addressed: each selected BB thread or external session responds independently. Two threads belonging to one bot remain two recipients.

An actor and its session are not interchangeable IDs. Mixed actor/session targeting and coverage rules remain open; never silently count one session response as satisfying both without a defined rule.

A broadcast fan-out is not a guarantee of simultaneous execution. Each recipient has independent receipt/response evidence and adapter outcome. Failures for one do not erase the tx or other responses. An empty audience must be reported explicitly rather than presented as successful delivery to listeners. Large fan-outs need bounded audience previews/limits; thresholds remain open.

`--over` is the proposed reply expectation; `--require-ack` is the proposed acknowledgment expectation. These are distinct from a work request. Defaults and whether wilco/done satisfy an ack request need a formal coverage rule. An acknowledgment is not a substantive answer to a question.

## Digest and notification behavior

`check` includes relevant new txs, required responses and open commitments. Recent-message windows can filter discovery, not unresolved obligations. A count digest does not generate receipts for unseen bodies.

Do not create new notification txs for receipt/ack changes. Suppress self-pings and deduplicate adapter hints by recipient and new-tx watermark. Signal loss is repaired by reading durable state; signal replay must not duplicate txs or commitments. Use explicit author-scoped idempotency rather than promising exactly-once network delivery.
