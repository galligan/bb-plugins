# Radio

Short transmissions. Durable coordination.

Radio is a BB plugin being built for communication between people, BB threads, persistent bots, and external agents. The intended product uses transmissions for the essential update or request and dispatches for supporting detail. Participants will be able to listen to channels, reply, acknowledge, accept responsibility, and broadcast to a defined audience without treating every message as permission to start work.

**Status: transmission domain layer.** `bb-plugin-radio` has a backend package and tests against BB 0.49.0 / public SDK 0.6.132. Loading the backend initializes plugin-owned SQLite storage through append-only migrations. Its internal domain API provides a stable station and human identity, actors, BB threads, external sessions, project/main-channel/subchannel records, handles/aliases, address parsing/resolution and immutable transmissions/replies with exact replay. There are no communication commands, RPC/native tools, HTTP routes, UI or marketplace entry yet. All command examples and communication API shapes in these documents remain proposals, not available operations. The design was developed with Matt and researched on 2026-11-10; its unresolved decisions remain open.

Readable project/channel names are normalized before allocation or rename: `Pay__Ments` becomes `pay-ments`, and `cut--over` becomes `cut-over`. Results include the requested and canonical spelling and whether it was corrected. Names contain at most 64 lowercase ASCII letters/digits with single hyphens between segments; raw input is bounded to 256 characters. Empty or oversized results are rejected without truncation, and collisions never reassign an existing identity. Renames preserve canonical IDs. Actor display names and opaque IDs are separate from readable addressing names.

External registration receives trusted principal context separately from strict self-reported metadata. Client session IDs are unique within that principal; they never replace canonical Radio IDs or grant ownership of another actor. Session names, providers and models stay on their session records; the durable principal actor does not inherit or track one session's report. BB thread registration preserves its existing ID and requires an explicit owner actor, without inferring ownership from parentage. These are internal domain contracts; authentication and public adapters are later layers.

Handle assignment and rename require adapter-authenticated owner or human context. Ordinary renames retain aliases. Human reclaim transactionally assigns a primary name, allocates a collision-free fallback for a displaced primary holder and records the reassignment. Reclaiming an alias leaves its prior holder's current primary intact. Name collisions, aliases and self-reported metadata cannot grant authority to change another identity.

The body parser preserves original text/offsets and returns canonical tokens with correction information. Literal quotes, inline/fenced code, blockquotes and escapes do not expand addresses; malformed syntax fails before resolution. Resolution receives an explicit authorized project scope, refuses cross-project fallback and returns qualified choices on ambiguity. `ch:` references and `@ch:` audiences resolve to the same channel ID with distinct token kinds. The transmission service freezes direct recipients. This layer does not select subscribers, deliver messages or start turns. See [identity](docs/identity.md) for the literal-region and authorization contracts.

The internal `transmissions.send(context, request)` operation atomically stores immutable content, canonical refs/tags, direct recipients and the author/principal-scoped replay binding. Context contains authenticated author/session ownership and project access. An identical retry returns the original ID and audience even after handle reassignment; a changed request with the same key conflicts. Reads and cursor-based channel scans check authorized project scope and never manufacture receipt evidence. Replies stay in their accessible parent channel and inherit no audience; mention or supply recipients explicitly.

Bodies contain 1–400 Unicode code points, counting all inline tokens and Markdown; the raw input cap is 2000 UTF-16 code units. Nothing is truncated or rewritten. Requests allow 16 structured HTTP(S) URL/canonical transmission/participant/channel refs and 100 distinct direct recipients (at most 1000 raw recipient-ID entries); scans return at most 50 records. External refs are stored without fetching or claiming access. Channel broadcasts currently fail clearly until the subscription layer can snapshot listeners atomically. See [protocol](docs/protocol.md) for the implemented contract and remaining planned semantics.

## Development

Use the repository's Bun 1.3.14 and Node 24.x runtimes. Install dependencies at the repository root with `bun install --frozen-lockfile --ignore-scripts`. From this directory, run `bun run check`, `bun run test` and `bun run build`; run `bun run verify` at the repository root before pushing.

Tests use the public SDK fake host and real temporary SQLite databases. They cover first load, repeated initialization, database reopen, plugin reload/disposal, independent station identity, failed migration rollback, changed migration history, metadata provenance, principal-scoped external sessions and project/channel renames. This establishes the storage contract in the harness, not live BB installation or delivery behavior. BB owns the database handle and closes it on reload/disposal; Radio does not close the shared handle itself.

The current schema contains station, participant, project, channel, handle, reassignment, transmission and frozen recipient records. Receipt/response and subscription tables will accompany their owning behavior. Zod validates metadata at the boundary. SQLite and harness peers remain development dependencies; the host supplies the runtime database.

## Design documents

| Document                                       | Owns                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Product](docs/product.md)                     | Purpose, vocabulary, writing style, dispatches, surfaces and user flows                                  |
| [Identity and addressing](docs/identity.md)    | Canonical IDs, handles, names, channel references, external sessions and `@user`                         |
| [Protocol](docs/protocol.md)                   | Transmissions, receipts, acknowledgments, commitments, listening and broadcasts                          |
| [Delivery](docs/delivery.md)                   | Session delivery options, lifecycle boundaries, explicit stops and notification loops                    |
| [Architecture](docs/architecture.md)           | Storage, adapters, authentication, bot boundary and cross-station communication                          |
| [Compatibility and research](docs/research.md) | Verified SDK contracts, source references, historical precedents and limitations                         |
| [Scope and decisions](docs/decisions.md)       | Settled direction, proposed defaults, unresolved decisions, implementation stages and verification gates |

Read [Scope and decisions](docs/decisions.md) before treating a proposed default as settled. Current Radio terminology takes precedence over historical Radio and Dispatch material.

## Example

```sh
bb radio listen ch:payments/cutover
bb radio tx --ch payments/cutover \
  "@ch:payments/cutover Cutover moved to Thursday. Confirm readiness. #release" \
  --ref dispatch:D-42
bb radio check
bb radio ack TX-17
bb radio wilco TX-17
bb radio reply TX-17 "Migration verified against staging." --done --ref pr:142
```

A broadcast creates one transmission with individual recipient records. Reading a count is not receiving the transmission. Receiving it is not acknowledging it. Acknowledging it is not accepting work. Accepting work is not completing it.
