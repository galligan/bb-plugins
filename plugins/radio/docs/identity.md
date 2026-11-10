# Identity and addressing

## Canonical identity

Records reference immutable IDs, never mutable handles as keys. A BB thread uses its existing `thr_...` ID; Radio does not mint a replacement thread identity. Radio-owned actors, external sessions, channels, dispatches and stations have opaque immutable IDs. Exact ID encoding is an implementation decision; deterministic IDs derived from mutable handles are not appropriate.

A cross-station reference includes the home station ID and object ID. Project identity is also canonical; changing a project's readable qualifier must not redirect historical records.

Keep these relationships separate:

- Actor owns or represents a session.
- BB thread parentage describes its conversation tree.
- Bot main-conversation mapping chooses current routing for a persistent collaborator.
- Reporting contracts choose destinations and obligations.
- Channel subscriptions describe attention.

None can safely be inferred from another. A child thread need not report to its parent or to its bot's main conversation.

## Syntax

| Form | Meaning |
| --- | --- |
| `@reviewer` | Participant handle within the current project context |
| `@payments:reviewer` | Participant handle explicitly qualified by project |
| `@user` | Reserved alias for the station's human user |
| `--ch payments/cutover` | Post in the specified channel |
| `ch:payments/cutover` | Reference a channel without addressing its listeners |
| `@ch:payments/cutover` | Address the eligible listeners of that channel |
| `#security` | Topic hashtag |

Reserve `@ch:` and `@user` so ordinary handle allocation cannot capture them. Treat the first channel path component as the project channel in the initial proposal. Channel hierarchy depth, project-slug constraints and remote syntax remain open. An optional prefix in `--ch` values is an ergonomic proposal, not required grammar.

Resolve a bare participant handle inside the current project when one exists. A failed local lookup must not silently target another project. Without project context, resolve only a unique accessible match; otherwise return qualified choices. Qualified addresses resolve only in their named project.

Resolve addressed participants and channels at send time and store their canonical IDs along with the original token for historical display. Unknown addressing mentions fail with useful diagnostics. Quoted text and code should not accidentally expand audiences; exact parsing/escaping rules need to be settled before implementing the parser. Literal prose must remain expressible.

Channel references and tags do not notify. Posting in a channel is not itself a broadcast. Explicit audience expansion uses `@ch:...`.

## Handles and renaming

Handles are project-scoped, assignable readable names. A handle can identify a specific thread/session or a durable bot/actor; resolution and UI show the target type. A bot handle can route to a changing main conversation. A thread handle remains attached to that thread until explicitly reassigned.

A rename changes address metadata, not identity, messages, receipts, commitments or subscriptions. Channel/subchannel IDs remain stable through name or parent changes. Ordinary rename aliases are a proposed convenience; an alias reserves its old name until removed.

Matt can explicitly reclaim a handle for a durable identity. Atomically rename the displaced holder to an available fallback, release any conflicting alias, and assign the desired handle. Show affected identities and record the reassignment. Reclamation changes future address lookups only. It does not change the BB thread title unless separately requested, migrate messages, or transfer commitments.

Historical displays may show the handle used when sent, but their links resolve by canonical ID. A reclaimed handle cannot remain an alias for its former holder.

## Automatic naming

A fast, inexpensive model may propose handles from a thread title, short task description, project and bot ownership. Radio validates and atomically allocates the name. The model does not authorize reclamation or decide identity.

Explicit names/reservations win. Generate once; conversation drift and title changes do not continually rename a participant. Try a bounded candidate list, then use a deterministic suffix/fallback. Naming failure must not block canonical-ID communication. Limit model context to what is needed for naming. Model choice, cost limits and whether automatic naming is opt-in remain implementation/product decisions.

## Human user

`@user` always resolves to the station's durable human actor. Settings supply the user's display name and optional personal handle, such as Matt / `@matt`; both addresses resolve to the same ID. Renaming either does not alter history. External agents resolve `@user` at the station they connected to. A remote human must be addressed with explicit station scope; do not guess from identical display names.

## External identity and self-reporting

External agents are first-class participants without BB thread IDs. They may supply a session ID, session name, tool, provider and model. Radio can issue an external session ID when none is available. Scope client-provided session IDs by authenticated principal/issuer to prevent collisions.

Distinguish authenticated principal, BB-supplied metadata and self-reported metadata. A claimed name/provider/session ID is attribution, not authority to act for another participant. Shared-token deployments cannot promise independently authenticated agents; see [architecture](architecture.md).

Hookless sessions explicitly register/check in, read, confirm receipt, acknowledge and check out. Show last reported activity rather than claiming live presence. Timeout or disappearance does not complete/abandon commitments. Bot/actor responsibility survives session changes; a specific session's response obligation requires explicit delegation or waiver to transfer.
