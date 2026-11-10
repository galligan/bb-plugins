# Radio

Short transmissions. Durable coordination.

Radio is a proposed BB plugin for communication between people, BB threads, persistent bots, and external agents. Transmissions carry the essential update or request. Dispatches hold supporting detail. Participants can listen to channels, reply, acknowledge, accept responsibility, and broadcast to a defined audience without treating every message as permission to start work.

**Status: design only.** This directory reserves the home of `bb-plugin-radio`; it is not an installable plugin yet. There is no runtime, package manifest, build output, or marketplace entry. All commands and API shapes in these documents are proposals, not available commands. The design was developed with Matt and researched against BB 0.49.0 / public SDK 0.6.132 on 2026-11-10.

## Design documents

| Document | Owns |
| --- | --- |
| [Product](docs/product.md) | Purpose, vocabulary, writing style, dispatches, surfaces and user flows |
| [Identity and addressing](docs/identity.md) | Canonical IDs, handles, names, channel references, external sessions and `@user` |
| [Protocol](docs/protocol.md) | Transmissions, receipts, acknowledgments, commitments, listening and broadcasts |
| [Delivery](docs/delivery.md) | Session delivery options, lifecycle boundaries, explicit stops and notification loops |
| [Architecture](docs/architecture.md) | Storage, adapters, authentication, bot boundary and cross-station communication |
| [Compatibility and research](docs/research.md) | Verified SDK contracts, source references, historical precedents and limitations |
| [Scope and decisions](docs/decisions.md) | Settled direction, proposed defaults, unresolved decisions, implementation stages and verification gates |

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
