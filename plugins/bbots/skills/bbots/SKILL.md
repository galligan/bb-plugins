---
name: bbots
description: Create and inspect persistent Bots, recover partial setup, pull current briefs, and inspect standing guidance and execution defaults.
---

# Bots

Use `bb bot status` for supported features and `bb bot list` / `show <bot-id>` for identity, home, main and setup errors. Pull `bb bot brief <bot-id> --json` during ordinary turns when current state matters. It reports current revisions, future execution defaults, the recorded task source with live availability and remaining unavailable memory/contract features; those are not guaranteed-fresh injected instructions. If another plugin owns the alias, use `bb plugin run bbots ...`.

`create --machine <host-id>` creates Bob; `--name` selects another name. It creates a persistent home outside repositories and starts one short setup acknowledgement. Retain an explicit `--request-id <uuid>` before scripted submission and reuse it only with identical options after uncertain delivery. `--association-mode none|all|selected` is responsibility scope; repeat `--project <id>` for selected projects. It does not move the main home or grant new permissions.

Use `resume <bot-id>` after restoring an offline machine or the recorded home. Resume reconciles existing progress without respawning an uncertain main or resending its prompt. A missing established home must be restored; never silently recreate an empty collaborator. Inspect native requests/queues when setup reports uncertain delivery rather than issuing another creation blindly. Native Stop applies per thread; inspect and explicitly cancel held queue entries when work must be discarded. Do not treat idle as permission to resume a canceled assignment. Bots cannot control another plugin's compaction/retry or the native Send now override.

Use `rename <bot-id> --name <name> --revision <current>` for an explicit revision-checked rename. Identity/home remain stable; existing pin preference is preserved. Use `soul show <bot-id>` to inspect revisioned SOUL.md and the `bbots-soul` skill for deliberate changes. It is not a live home file. Current revision and last supplied revision are separate; applied revision remains unknown without a provider receipt. Do not claim an already running session has refreshed instructions.

Use `models show <bot-id>` for future conversation defaults. `models update` saves a complete revision-checked JSON document with `main`, `worker` and `fallback` choices. A null worker inherits main; an explicit worker object defines independent native choices, with omitted values inheriting BB policy. A fallback cannot set permissions and automatic fallback remains disabled. Saving starts no turn and does not mutate an existing main. Use BB's native controls for that conversation's execution choices; provider/model/reasoning availability is validated by BB when a new conversation is created. Main creation also accepts `--provider`, `--model`, `--reasoning` and `--permissions`; omission preserves BB defaults.

Use `tasks show <bot-id>` to read task authority before choosing or changing work. `tasks select` and `tasks create` require an explicit source instruction, expected revision, author and reason. A configured tracker remains authoritative during an outage; do not create a replacement or switch to Markdown. If creation is uncertain, inspect the recorded intent and native Tasks board before explicit `tasks recover` with its confirmed stable ID. Prefix matching does not prove original identity after deletion/reuse; confirm the intended board independently.

When Tasks is absent at the initial task-source choice, use `tasks markdown-init` with the expected source revision, author and reason. Inventory must confirm absence; disabled Tasks and RPC errors are not absence. Use `tasks markdown-resume` only to reconcile the same interrupted initialization. Do not overwrite an occupied file or choose another home.

In Markdown mode, use `tasks read` and `tasks write --hash <current-hash> --markdown '<complete-file>'`. These operations route to the original home host, including from remote workers. Preserve the complete file; arbitrary Markdown has no inferred task counter. Read again after a stale write or uncertain receipt. Coordinate external editors; only Bots writers share its lock. A retained lock requires inspecting stopped owned work and the original host before manual recovery. Never remove a lock merely because the caller timed out.

Automatic maintenance, continuity, workers and fallback are disabled. Do not invent commands for memory, commitments or reporting before those features ship. Create no background work during the setup acknowledgement.
