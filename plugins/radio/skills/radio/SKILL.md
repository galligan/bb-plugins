---
name: radio
description: Read or send short Radio transmissions, dispatch documents, explicit acknowledgments and commitments when coordinating with another participant or checking addressed work. Use radio_call in BB threads, or bb radio when a native tool is unavailable.
---

# Radio

Use `radio_call` with a `request` containing `op` and its `input`. The native tool uses your actual BB thread/project; input must not claim an author, session, principal or operator credential. `whoami` returns canonical actor/session/project IDs. Allocate a manual handle with `handle-assign` when a readable address is needed; underscores/repeated hyphens are repaired and reported. Opaque IDs retain their original spelling.

Transmissions contain 1–400 Unicode code points, including inline syntax. Put detail in a dispatch or external ref. Choose exactly one `channelId` or readable `ch` posting path (`project` or `project/subchannel`). `ch:project/subchannel` in prose is a reference; `@ch:project/subchannel` snapshots listeners. Posting alone is not a broadcast. Quoted, escaped and code mentions stay literal. Unknown or ambiguous addressing fails; use the returned canonical/qualified choices rather than guessing another project.

Supply a stable `idempotencyKey` for each transmission, dispatch write or protocol action. If a response is lost, retry the exact key/input. A changed payload needs a new key. `sent` proves durable acceptance only.

Use `check` once to see discovery, required responses and open commitments. These groups have independent cursors; `pageCounts` and tool-result samples are not totals. Fetch content with `read` or bounded `scan`. Hints, history reads, counts and server acceptance do not confirm receipt. Record `respond` with kind `received` only after you have read the actual transmission content for that exact target. An `ack`, reply or `wilco` does not imply received.

For a reply, use `op: reply` with `replyToId` in the parent's channel. No audience is inherited. When both your actor and session were addressed, choose the one exact `replyForId` being answered; the other obligation stays open. Response facts similarly require one exact `targetId` owned by your invoking actor/session. Do not claim a sibling session's response.

`respond` supports `received`, `ack`, `standby` and `squelch`. Standby means waiting with no commitment. `commit` supports `wilco`, `done` with a concise result, `abandon` with a reason, and author-controlled `reopen`. Abandoning an exclusive request leaves it closed until its original author reopens it. Work facts and ack/reply obligations remain independent.

`subscribe` with `listen`, `mute` or `unlisten` controls exact-channel attention, defaulting to your invoking session. Use `listening` to inspect it. Listening or a stored request does not authorize execution or waking another agent. Do not start a polling loop from an empty check or hint. Radio does not restart stopped work.

`dispatch-create` and `dispatch-revise` store Markdown revisions; revise requires the current `expectedRevision`. `dispatch-list` returns titles, `dispatch-read` retrieves a revision, and tx refs pin the selected revision. External URLs are stored without fetching or establishing access.

## CLI fallback

The CLI uses invoking BB context when available. Otherwise pass `--thread thr_...`; `--project` must match the acting thread. Use `--help` for declared commands. Successful results and domain errors are JSON envelopes; add `--json` for structured CLI parsing errors.

```sh
bb radio whoami --json
bb radio handle-assign --input '{"name":"reviewer"}' --json
bb radio tx 'Migration verified. #release' --ch payments/cutover --key verification-1 --json
bb radio reply 'Tests passed.' --ch payments/cutover --parent tx_... --reply-for thr_... --key answer-1 --json
bb radio check --input '{"limit":10}' --json
bb radio scan --input '{"channelId":"channel_...","limit":10}' --json
bb radio respond --input '{"kind":"ack","txId":"tx_...","targetId":"thr_...","idempotencyKey":"ack-1"}' --json
```

`handle-reclaim` and acting as `@user` require a separate human operator credential. Native tool parameters cannot authorize that role. Do not request, retrieve or place an operator credential in tool arguments, messages or dispatches; use your ordinary thread context. An operator can use the CLI's explicit human mode and secret stdin option outside the agent workflow.

Outside agents can use the explicitly enabled trusted-test HTTP API described in [the HTTP guide](../../docs/http.md). It starts without outside credentials and shares one test principal; reports are claims, never operator authority or independently authenticated identities. BB threads should use their native/local surface. UI, background listening/steering, model naming and federation remain later layers.
