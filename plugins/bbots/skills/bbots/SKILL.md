---
name: bbots
description: Create and inspect persistent Bots, their home and main conversation, and recover partial setup.
---

# Bots

Use `bb bot status` for supported features and `bb bot list` / `show <bot-id>` for current identity, home, main and setup errors. `--json` returns bounded structured output. If another plugin owns the alias, use `bb plugin run bbots ...`.

`create --machine <host-id>` creates Bob; `--name` selects another name. It creates a persistent home outside repositories and starts one short setup acknowledgement. Retain an explicit `--request-id <uuid>` before scripted submission and reuse it only with identical options after uncertain delivery. `--association-mode none|all|selected` is responsibility scope; repeat `--project <id>` for selected projects. It does not move the main home or grant new permissions.

Use `resume <bot-id>` after restoring an offline machine or the recorded home. Resume reconciles existing progress without respawning an uncertain main or resending its prompt. A missing established home must be restored; never silently recreate an empty collaborator. Inspect native requests/queues when setup reports uncertain delivery rather than issuing another creation blindly. Native Stop applies per thread; inspect and explicitly cancel held queue entries when work must be discarded. Do not treat idle as permission to resume a canceled assignment. Bots cannot control another plugin's compaction/retry or the native Send now override.

Use `rename <bot-id> --name <name> --revision <current>` for an explicit revision-checked rename. Identity/home remain stable; existing pin preference is preserved. The initial SOUL.md is revisioned in SQLite and supplied at session construction. It is not a live file to edit in the home; deliberate editing/model configuration follows in the next slice. Do not claim an already running session has refreshed instructions.

Automatic maintenance, continuity, workers and fallback are disabled. Do not invent commands for memory, tasks or reporting before those features ship. Create no background work during the setup acknowledgement.
