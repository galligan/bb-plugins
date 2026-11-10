# Architecture and boundaries

## Smallest useful shape

One BB server plugin owns one Radio database and domain service. Thin adapters expose CLI, native tools, typed local RPC, token-authenticated HTTP and additive UI. Use the public SDK; do not import BB internals, sibling plugin source, old Radio implementation code or Dispatch runtime code.

Future package identity is `bb-plugin-radio`, plugin ID `radio`. No package/runtime is created in this design stage. Pin the installed compatible SDK when implementation begins, and follow repository build/release procedures then.

## Persistence model

Use `bb.storage.database()` and ordered append-only migrations. SQLite transactions handle tx creation, audience expansion, idempotency, handle allocation and exclusive claims. The plugin database belongs to the BB server; avoid direct client database access and worktree-relative storage.

Conceptual records, not a final schema:

| Record                        | Purpose                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Station                       | Immutable home-instance identity and editable name                                             |
| Actor / session               | Stable participant plus concrete working context and metadata provenance                       |
| Handle / alias / reassignment | Project-scoped address bindings and explicit history                                           |
| Channel                       | Immutable ID, project ID, optional parent ID and editable name                                 |
| Subscription                  | Participant/session, channel and mute state                                                    |
| Transmission / ref / tag      | Immutable content, reply relation and structured artifact/topic relations                      |
| Recipient                     | Frozen audience membership, target type, response expectations and later explicit dispositions |
| Receipt / response event      | Delivery evidence, confirmations and participant actions with acting-session provenance        |
| Commitment / claim            | Responsibility and exclusive ownership where requested                                         |
| Dispatch / revision           | Plugin-owned long-form content and stable/pinned references                                    |
| Idempotency record            | Principal-scoped request binding and durable result                                            |

Append-only receipt/response/commitment history supports audit and derived current views. It does not imply conflict-free semantic merges or require event sourcing for every table. Handles/subscriptions may have current rows plus relevant history. A server-assigned cursor can support reliable incremental reads independent of wall-clock ordering; exact pagination and retention rules are implementation decisions.

No automatic deletion or retention cutoff is proposed. Removal/export/backup and handling sensitive content need policy before release; immutable ordinary txs need not preclude a future audited redaction/removal operation. Do not store credentials in txs or logs. Plain Markdown must render through safe host components.

## Surface contract

Each adapter authenticates/resolves caller context, validates input, calls shared domain operations and projects bounded results. No separate semantics per surface. Mutations need stable error categories for unknown/ambiguous address, forbidden, conflict, invalid input, unavailable delivery and partial remote outcome.

Reads use limits/cursors. Distinguish content reads from receipt confirmation. Writes return canonical IDs and evidence actually obtained, not inferred semantic progress. Configure limits for body/ref counts, dispatch size, broadcast audience and wait duration before implementation; do not build unbounded tool responses.

UI invalidation/realtime signals carry IDs or minimal change hints; clients refetch authorized state. Ephemeral signals are not a message bus of record. Handle disposal and reconcile on startup/reconnect.

## Authentication and access

Initial trusted-personal deployment can use BB's per-plugin HTTP token in `x-bb-plugin-token`. It authorizes that token holder for the exposed API; it does not identify independent external agents or enforce per-agent scopes. Self-reported author labels remain attribution. Local RPC caller identity distinguishes plugin from client, not human from agent.

If separately revocable external agents are required, introduce a small credential-to-principal mapping with hashed tokens, allowed scopes and revocation. An external principal may report session metadata but cannot acquire another actor by supplying its handle. Canonical-ID lookup is not authorization. Apply channel/document access checks to reads, refs, replies and broadcasts, not just writes.

Secret material stays in server secret settings/storage, never frontend settings, URLs, dispatches or logs. Prefer header tokens. No credential was created or inspected during research.

Remote reachability and authentication are separate. Verify TLS/private tunnel or BB routing for these routes before claiming off-host support. The getbb.app connection does not by itself prove plugin route forwarding. Do not expose a route with `auth:none` merely to reach external clients.

## Bot plugin boundary

Radio owns transmissions, dispatches, addressing records, receipts, commitments, subscriptions, audience selection and communication adapters. It can record a commitment without scheduling its execution.

The bot plugin owns persistent collaborators, bot-to-thread ownership, current main conversation, working/monitoring conversations, reporting contracts, context responsibilities and authorized execution/wake policies. Parentage and reporting destinations remain separate from bot ownership.

Compose through validated plugin RPC, not shared storage. A proposed `bb bot msg` resolves invoking thread -> bot -> chosen destination and posts through Radio. `bb bot report` applies the reporting contract; its destination need not be the main conversation. Those commands remain exploratory. Make immediate execution effects explicit if offered alongside passive messages.

Radio may maintain the common address registry while bot RPC registers/resolves its endpoints. Exact ownership of shared identity records must be settled before implementation to avoid two conflicting registries. Missing bot plugin should not prevent thread-to-thread or external Radio use.

## Stations and future cross-server communication

A station is a Radio instance attached to a BB server, with a stable ID and mutable name. Names such as `work` and `home` are convenient qualifiers, not global identity. Multiple enrolled hosts on one BB server do not automatically become stations.

Reserve station scope in canonical addresses now. Human syntax remains open; `@work::payments:reviewer`, `ch:work::payments/cutover` and `@ch:work::payments/cutover` are examples only. Existing slash paths should not become ambiguous remote addresses. Unqualified `@user` targets the current station's human; remote human addressing is explicit.

Start with explicitly paired trusted stations and allowed channel/participant scopes. No global discovery, shared filesystem, database replication or full distributed identity platform is required. Forward bounded protocol operations through authenticated station adapters. Preserve original author, source station and tx ID; record forwarding separately. Deduplicate loops/retries by origin station and tx/event IDs rather than reauthoring a copy.

The destination station owns its listener set and snapshots remote broadcast recipients when it accepts the fan-out request. Persist and replay that snapshot on retries. Source `sent` means source acceptance; station acceptance is transport evidence, not recipient `received`. Remote audience/receipt status can remain pending or partial without inventing completion. There is no atomic all-station audience snapshot promise.

Remote replies and response events reference the original canonical tx and recipient identities. Channel access changes and revoked pairings must stop future forwarding; already accepted records need an explicit retention policy. Listener export/privacy, offline retry bounds, actor equivalence across stations, remote handles and pairing UX remain open.

Implement station transport after local/external-client behavior is proven. Stable station-scoped IDs preserve the option without requiring federation for the first release.
