# Architecture and boundaries

## Smallest useful shape

One BB server plugin owns one Radio database and domain service. Thin adapters expose CLI, native tools, typed local RPC, trusted-test HTTP (initially without outside-agent credentials) and additive UI. Use the public SDK; do not import BB internals, sibling plugin source, old Radio implementation code or Dispatch runtime code.

Package identity is `bb-plugin-radio`, plugin ID `radio`, pinned to public SDK 0.6.132. The current backend initializes identity/project/channel storage, immutable transmissions and versioned Markdown dispatches; the shared local CLI/RPC/native adapters are implemented. HTTP and additive UI remain separate layers. Follow repository build/release procedures as each layer is implemented.

## Persistence model

Use `bb.storage.database()` and ordered append-only migrations. SQLite transactions handle tx creation, audience expansion, idempotency, handle allocation and exclusive claims. The plugin database belongs to the BB server; avoid direct client database access and worktree-relative storage.

The foundation allocates a singleton station row with an opaque `station_` UUID and reuses it across database reopen and plugin reload. The identity layer adds participant, project and channel records through appended migrations. Actor/session metadata records its provenance; trusted external principal context is supplied separately from self-reports. The transmission layer adds immutable content, direct-recipient snapshots and replay bindings. The dispatch layer adds stable documents, immutable revisions and exact create/edit replay; title listings omit content, edits require expected revisions and content reads check project access. Other records below are conceptual until their owning layer is implemented.

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

Matt explicitly chose no outside-agent credentials for the first trusted-environment test. This supersedes the original shared-token proposal. All such callers share a deployment-authorized test principal; claimed session metadata cannot grant BB actor/human authority. Future code-based authentication is deferred until after testing, with its exact design open. This test mode must be explicitly enabled for its deployment; no route reachability or exposure follows from implementing it.

Local RPC distinguishes plugin from client, with app, CLI and agents all classified as clients. Thread/project selection attributes an ordinary local request within the trusted BB account; it is not cryptographic per-agent authentication. Native tools use host invocation context. Ordinary CLI/RPC require explicit thread attribution when context is absent. Resolve the actual thread and matching project through the public SDK, preserve registered ownership, and scope the initial operation to that project. No parentage, title or bot relationship grants authority.

Acting as the station human requires an explicit mode and a separate server operator credential, including from a local client. Re-read the secret per privileged request so rotation/unset takes effect immediately. Compare digests without content-dependent timing, and pass only the resulting trusted context into domain operations. The credential must not become a native tool argument, transmission/request replay field, dispatch, output or log. Server secret settings hold the configured credential; later CLI input may use the SDK's secret stdin option to avoid process arguments. No credential is provisioned by source work.

If independently revocable external identities are later required, introduce a small credential-to-principal mapping with allowed scopes and revocation. Canonical-ID lookup never supplies ownership. Apply channel/document access to reads, refs, replies and broadcasts. In the initial no-credential test, do not claim isolation among external callers or expired per-agent credential verification.

Remote reachability and authentication remain separate. Verify authorized TLS/private routing before claiming off-host support. The getbb.app connection does not prove plugin route forwarding. An explicitly enabled unauthenticated trusted test route implements Matt's choice; do not use that mode as a generic reachability workaround or silently expose an existing instance.

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

Verified local project bootstrap keeps an existing Radio mapping. For a new project whose BB display name is invalid, reserved, too long or already allocated after normalization, it uses a bounded `project-` qualifier derived from the immutable BB project ID. It never truncates the proposed name, displaces another project or silently renames an existing mapping. The resulting canonical qualifier is returned by project registry reads and remains explicitly renameable. BB thread IDs are opaque and retain hyphenated suffixes without applying readable-name normalization.
