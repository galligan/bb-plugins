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

| Form                    | Meaning                                               |
| ----------------------- | ----------------------------------------------------- |
| `@reviewer`             | Participant handle within the current project context |
| `@payments:reviewer`    | Participant handle explicitly qualified by project    |
| `@user`                 | Reserved alias for the station's human user           |
| `--ch payments/cutover` | Post in the specified channel                         |
| `ch:payments/cutover`   | Reference a channel without addressing its listeners  |
| `@ch:payments/cutover`  | Address the eligible listeners of that channel        |
| `#security`             | Topic hashtag                                         |

Reserve `@ch:` and `@user` so ordinary handle allocation cannot capture them. The first channel path component is the project channel, with at most one subchannel component. Readable names contain lowercase ASCII letters/digits separated by single hyphens; underscores and consecutive hyphens are not stored. Name allocation and rename repair separator runs, trim edges and report the canonical spelling. Empty/oversized results and collisions need explicit resolution rather than silent truncation or displacement. Remote syntax remains open. An optional prefix in `--ch` values is an ergonomic proposal, not required grammar.

Resolve a bare participant handle inside the current project when one exists. A failed local lookup must not silently target another project. Without project context, resolve only a unique accessible match; otherwise return qualified choices. Qualified addresses resolve only in their named project.

Resolve addressed participants and channels at send time and store their canonical IDs along with the original token for historical display. The implemented internal parser returns original text/offsets, canonical token spelling and correction information; it does not rewrite prose. Unknown addressing mentions fail with useful diagnostics. Public send adapters remain a later layer.

The parser ignores backslash-escaped characters, matching straight/curly quotes, matching backtick spans, backtick/tilde fenced blocks, Markdown blockquote lines and four-space indented code. Apostrophes within words remain prose, including contractions inside a quoted region. An unmatched opening quote requires closure or an explicit backslash escape; an unclosed code span/fence keeps the remaining content literal. These conservative rules prevent partial resolution of malformed input. Parsing accepts at most 16384 raw characters; this is an internal resource bound, not the proposed transmission prose budget.

Names inside tokens also report repairs, so `@Agent__Name` resolves through canonical `@agent-name` while preserving the original token. Address structure itself is strict: participant addresses have at most one project qualifier, and channels at most one subchannel. Dot-separated or otherwise malformed participant paths fail rather than silently resolving a valid prefix. `@user` is the human alias; `user` and `ch` cannot be allocated as participant handles, and `ch` cannot be a project qualifier because `@ch:` owns that prefix.

The resolver receives an explicit list of adapter-authorized project IDs, capped at 100, and optional current project context. It does not derive access from a claimed handle, metadata or parentage. Public adapters must construct this scope and the handle mutation caller context from authenticated authority, not from a request body. No public authentication or transport is implemented by this domain layer.

Channel references and tags do not notify. Posting in a channel is not itself a broadcast. Explicit audience expansion uses `@ch:...`.

## Handles and renaming

Handles are project-scoped, assignable readable names. A handle can identify a specific thread/session or a durable bot/actor; resolution and UI show the target type. A bot handle can route to a changing main conversation. A thread handle remains attached to that thread until explicitly reassigned.

A rename changes address metadata, not identity, messages, receipts, commitments or subscriptions. Channel/subchannel IDs remain stable through name changes. Ordinary participant renames retain aliases; an alias reserves its old name until explicitly removed or reclaimed.

Matt can explicitly reclaim a handle for a durable identity. Atomically rename the displaced holder to an available fallback, release any conflicting alias, and assign the desired handle. Show affected identities and record the reassignment. Reclamation changes future address lookups only. It does not change the BB thread title unless separately requested, migrate messages, or transfer commitments.

Reclaiming a primary name chooses the first free bounded numeric suffix, skipping aliases as well as primary names. Reclaiming an alias reuses its prior holder's existing primary as the fallback instead of needlessly renaming that identity. All handle changes and the reassignment audit commit together; a failure rolls back the complete operation. Owner mutations and human reclaim receive trusted caller context separately from self-reported session fields.

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
