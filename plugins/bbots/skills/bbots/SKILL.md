---
name: bbots
description: Inspect the Bots plugin's development status and supported features.
---

# Bots

Run `bb bot status` (or `bb bot status --json`) to inspect the currently implemented features. If another plugin owns `bot`, use the explicit form `bb plugin run bbots status`.

This storage foundation does not provision or run native bot conversations. It registers no background maintenance, automatic continuity, fallback or workers. Native per-thread Stop remains the runtime control. Bots cannot prevent another plugin from compacting or retrying a conversation. Do not infer permission to resume a canceled assignment from an idle event.

Revisioned profile/document storage and logical IDs are implemented internally. Public creation, session-bound SOUL.md, bot homes and task integration follow in subsequent tasks. Do not invent commands for them or treat this skill as their implementation.
