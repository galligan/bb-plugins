---
name: bbots
description: Create persistent Bots and owned workers, inspect current briefs and reporting contracts, and send explicit native reports or replies.
---

# Bots

Use `bb bot status` for supported features and `bb bot list` / `show <bot-id>` for identity, home, main and setup errors. Pull `bb bot brief <bot-id> --json` during ordinary turns when current state matters. It includes the calling worker's current contract and future execution defaults; tasks, memory and commitments remain unavailable. Volatile state is not guaranteed-fresh injected guidance. If another plugin owns the alias, use `bb plugin run bbots ...`.

`create --machine <host-id>` creates Bob; `--name` selects another name. It creates a persistent home outside repositories and starts one short setup acknowledgement. Retain an explicit `--request-id <uuid>` before scripted submission and reuse it only with identical options after uncertain delivery. `--association-mode none|all|selected` is responsibility scope; repeat `--project <id>` for selected projects. It does not move the main home or grant new permissions.

Use `resume <bot-id>` after restoring an offline machine or the recorded home. Resume reconciles existing progress without respawning an uncertain main or resending its prompt. A missing established home must be restored; never silently recreate an empty collaborator. Inspect native requests/queues when setup reports uncertain delivery rather than issuing another creation blindly. Native Stop applies per thread; inspect and explicitly cancel held queue entries when work must be discarded. Do not treat idle as permission to resume a canceled assignment. Bots cannot control another plugin's compaction/retry or the native Send now override.

Use `rename <bot-id> --name <name> --revision <current>` for an explicit revision-checked rename. Identity/home remain stable; existing pin preference is preserved. Use `soul show <bot-id>` to inspect revisioned SOUL.md and the `bbots-soul` skill for deliberate changes. It is not a live home file. Current revision and last supplied revision are separate; applied revision remains unknown without a provider receipt. Do not claim an already running session has refreshed instructions.

Use `models show <bot-id>` for future conversation defaults. `models update` saves a complete revision-checked JSON document with `main`, `worker` and `fallback` choices. A null worker inherits main; an explicit worker object defines independent native choices, with omitted values inheriting BB policy. A fallback cannot set permissions and automatic fallback remains disabled. Saving starts no turn and does not mutate an existing main. Use BB's native controls for that conversation's execution choices; provider/model/reasoning availability is validated by BB when a new conversation is created. Main creation also accepts `--provider`, `--model`, `--reasoning` and `--permissions`; omission preserves BB defaults.

## Owned work and communication

When the user authorizes a distinct assignment, use `bb bot work '<assignment>' --title '<short task>' --project <project-id> --environment <ready-environment-id> --author <truthful-identity> --reason '<instruction>'`. An owned caller supplies its bot automatically; an unowned caller must select `--bot <bot-id>`. Retain `--request-id <uuid>` before scripted submission. This starts the assignment in one normal native thread; it is not a dormant draft.

Parentage and reporting are separate. `--parent <thread-id>` is optional and must belong to the working project. Native parent notifications default off. `--parent-notifications auto` can duplicate explicit reports. Set `--report-thread <ordinary-thread-id>` or `--report-conversation <logical-id>` for a non-main destination. Omission records this bot's main as the initial target. Use `--report-when`, `--stop-when`, `--context` and repeated `--source` for the selected agreement; evaluate its triggers yourself. The plugin does not watch task completion.

Use `work list <bot-id>` to find recorded workers and request IDs, and `work show <conversation-id>` to inspect uncertain setup. Reusing a request never automatically respawns an attempted worker. Inspect native thread history and queue before deciding on a new action after an uncertain receipt.

Pull `contract show <conversation-id> --json` before reporting or continuing changed work. For a deliberate reassignment, `contract update <conversation-id> --revision <current> --agreement '<complete-json>' --author <identity> --reason '<instruction>'` appends a revision. Saving does not start a turn, reparent a thread or resume a stopped assignment.

Use `report '<message>'` from the owned worker for its contract destination. Use `msg '<message>'` for the current main; an unowned caller must select `--bot`. Use `reply '<message>' --seq <native-message-sequence>` for the native agent sender of that incoming message. Do not infer a reply destination from prose or substitute the main when a contract is missing. A title or writable metadata does not establish ownership.

These are explicit new communications. Native queue-if-active delivery can start a recipient turn when idle, including after Stop. A report does not authorize resuming a previously canceled assignment. Treat it as a new communication under current instructions. Return native acceptance/queue evidence; do not claim it proves reading, completion or a response. If delivery is uncertain, inspect native history and queue; do not blindly resend.

Automatic maintenance, continuity and fallback remain disabled. Create no workers or other background work during the initial setup acknowledgement. Do not invent memory or task commands before those features ship.
