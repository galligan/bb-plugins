---
name: bbots
description: Inspect the Bots plugin's development status and supported features.
---

# Bots

Run `bb bot status` (or `bb bot status --json`) to inspect the currently implemented features. If another plugin owns `bot`, use the explicit form `bb plugin run bbots status`.

This development skeleton does not create or run bots. It registers no background maintenance, automatic continuity, fallback or workers. Native per-thread Stop remains the runtime control. Bots cannot prevent another plugin from compacting or retrying a conversation. Do not infer permission to resume a canceled assignment from an idle event.

Persistent identity, revisioned SOUL.md, bot homes and task integration are subsequent implementation tasks. Do not invent commands for them or treat this skill as their implementation.
