# Product design

## Purpose

Radio provides durable, concise coordination across conversations and tools. An agent can leave a useful message without interrupting another thread. A person or agent can discover relevant messages, answer them, accept responsibility, and leave evidence of completion. Outside agents participate without needing a BB thread or provider-specific lifecycle hooks.

Radio also supports optional live delivery and, eventually, communication across BB servers. Persistence and delivery are separate: failure to notify a session does not lose its message.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Station | A Radio instance associated with a BB server; future cross-server boundary |
| Channel | A project or coordination space within a station |
| Subchannel | A narrower coordination space under a project channel |
| Actor | A persistent participant: a human, bot or external collaborator |
| Session | A particular working conversation; a BB thread is one kind |
| Handle | A readable, assignable address resolving to a canonical identity |
| Transmission / tx | A short immutable message with optional recipients, replies, tags and artifact refs |
| Ping | A recipient-specific attention view of a transmission |
| Dispatch | A detailed document owned by Radio, or a referenced external document |
| Broadcast | One transmission addressed to a defined set of recipients |
| Commitment | A participant's explicit acceptance of responsibility for a transmission |

Radio uses familiar channel terminology. `station` does not mean channel. Inline `#hashtags` are topics, not channel addresses. `roger`, `stored`, and `delivered` are not user-facing protocol state names; the current terms are `ack`, `sent`, and `received`.

## Communication style

A transmission contains the whole point without containing the whole explanation. Lead with the result, change, question or request. Retain qualifications that affect decisions. Include the requested action when there is one. Put supporting detail in a dispatch or external artifact.

Good: “Auth fix passes locally. CI pending. Review the migration before merge.” Attach the relevant dispatch or PR.

Too compressed: “Auth green. Ship.” This loses the CI qualification and review requirement.

Too empty: “Update in D-42.” This forces everyone to open a document to discover whether it matters.

The historical 400-character prose budget with a 2000-character raw-body cap is a proposed starting point, not a final limit. Structured refs live outside prose; the complete request still needs bounded ref counts and payload size. Any inline-token exemptions must be explicit and bounded. Never silently truncate, auto-split or rewrite a transmission to pass validation. Return useful diagnostics so its author can shorten it or create a dispatch.

Human sentences take precedence over cryptic compression. The name and verbs provide Radio's personality; routine “Signal strong” or “Clear skies ahead” filler does not belong in normal output. Machine responses should be structured and bounded.

## Dispatches and external artifacts

An owned dispatch contains a stable ID, title, Markdown body, author, timestamps and revisions. It lives in plugin storage rather than a worktree or thread-storage directory. Any authorized participant can read it through UI, CLI, native tool or HTTP, including participants outside BB.

An update creates a revision. References can pin a revision when an assertion depends on exact evidence; readers can also request the latest revision. An external document reference records its URL and optional title/source without claiming to copy its contents or confer access. Radio should support URLs to Linear, Notion, PRs and other documents without requiring a connector for basic linking.

Radio stores communication and its supporting documents. It does not replace the authority of code repositories, issue trackers or canonical source documents. A dispatch can later be promoted into an authoritative external document and linked back. Document synchronization, collaborative editing, automatic link ingestion and a wiki hierarchy are outside the first useful scope.

Local file paths are not universal references. A file ref needs repository/revision or BB host/environment context, and an external reader may still lack access. Use an owned dispatch or accessible URL when the content must travel between systems.

## User and agent surfaces

- `tx`, `reply`, `check`, `scan`, `ack`, `wilco`, `standby`, `squelch`, `done`, `abandon` express communication and responsibility.
- `listen`, `mute`, `unlisten`, `listening` manage attention.
- Dispatch read/write operations provide detail without overloading transmissions.
- `tune` can show current identity, channel and subscription context. `out` can end a listening session; it does not abandon commitments.
- CLI, native tools, local RPC and external HTTP call the same domain operations. Their presentations may differ, but their semantics do not.

Exact command grammar and aliases remain open beyond the agreed `--ch`, `ch:...`, `@ch:...`, and handle forms. Examples are illustrative.

The BB UI should be an additive navigation panel with channel selection, an attention digest, transmission/reply view, dispatch reader and recipient response summary. Reuse host navigation, Markdown, links and public UI components. A thread context contribution can show relevant counts. Radio must remain useful with sidebar metadata disabled; it does not replace the thread sidebar.

`check` is an attention digest: incoming pings, requested replies/acks and unresolved commitments. `scan` is discovery/history. Recent-message filters must not hide outstanding responsibility. Expiration can eventually hide a broadcast from default discovery without deleting history; expiration controls are deferred.

## Representative flows

1. **Quiet report:** A worker posts to a bot or channel while another thread is busy. The sender gets `sent`. The recipient checks later, receives the content, optionally acknowledges and replies. No turn starts merely because the tx exists.
2. **External collaborator:** An external session identifies itself, subscribes to a channel, posts with an idempotency key, and receives replies through HTTP reads/listening. It confirms receipt where the transport cannot prove it. Hook support is optional.
3. **Unassigned work:** Matt posts a request with no recipient. An authorized worker discovers it and accepts it. If the request is exclusive, acceptance atomically claims it. The worker closes its commitment with evidence or abandons with a reason.
4. **Broadcast:** A tx mentions `@ch:payments/cutover`. Radio resolves eligible listeners once. Every selected thread/session receives an independent response record, including multiple sessions owned by the same bot.
5. **Stop and handoff:** Matt stops a thread. Delivery work is cancelled or held; txs and responsibilities survive. A successor bot conversation resolves the same actor and explicitly checks unresolved work. Session-specific required responses are not silently reassigned.
6. **Cross-station collaboration:** A paired station forwards a tx to an authorized remote channel. The destination resolves its listeners and returns durable recipient/receipt evidence. This is future scope, not currently verified transport.
