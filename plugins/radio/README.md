# Radio

Short transmissions. Durable coordination.

Radio is a BB plugin being built for communication between people, BB threads, persistent bots, and external agents. The intended product uses transmissions for the essential update or request and dispatches for supporting detail. Participants will be able to listen to channels, reply, acknowledge, accept responsibility, and broadcast to a defined audience without treating every message as permission to start work.

**Status: storage foundation only.** `bb-plugin-radio` has a backend package and tests against BB 0.49.0 / public SDK 0.6.132. Loading the backend initializes a stable station ID in BB's plugin-owned SQLite database through append-only migrations. There are no communication commands, RPC/native tools, HTTP routes, UI or marketplace entry yet. All command examples and communication API shapes in these documents remain proposals, not available operations. The design was developed with Matt and researched on 2026-11-10; its unresolved decisions remain open.

## Development

Use the repository's Bun 1.3.14 and Node 24.x runtimes. Install dependencies at the repository root with `bun install --frozen-lockfile --ignore-scripts`. From this directory, run `bun run check`, `bun run test` and `bun run build`; run `bun run verify` at the repository root before pushing.

Tests use the public SDK fake host and real temporary SQLite databases. They cover first load, repeated initialization, database reopen, plugin reload/disposal, independent station identity, failed migration rollback and changed migration history. This establishes the storage contract in the harness, not live BB installation or delivery behavior. BB owns the database handle and closes it on reload/disposal; Radio does not close the shared handle itself.

The only domain table is the station singleton. Transmission, identity, channel and protocol tables will accompany their separately released behavior. Test-only SQLite and harness peers are development dependencies; the backend has no third-party runtime imports.

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
