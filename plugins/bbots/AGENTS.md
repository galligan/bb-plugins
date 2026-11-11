# Bots planning and implementation

Read README.md and all linked design, review and handoff documents before changing behavior. Matt explicitly released the designated “bb Bots Builder” thread on 2026-11-10. Matt subsequently directed plugin implementation to proceed without waiting for maintainer changes. BOTS-3 tracks feature-specific limits; BOTS-18 is deferred and is not a predecessor for scaffolding or independent plugin work. Review and briefing alone were not the initial release.

The agreed names are Bots (display), bbots (plugin ID), and bb-plugin-bbots (package). Keep Radio, external bot messaging, Slack/webhooks, and a replacement sidebar out of the initial implementation.

Use the bb-plugin-authoring skill and current public SDK declarations. Treat the feasibility items in docs/plan.md as gates for the affected feature, not a global development hold; do not fill missing SDK support with BB internal imports or assumptions. Keep BB core's lifecycle, permissions, queue, and environment ownership intact.

Keep storage, memory, continuity, thread routing, tasks integration, and UI in focused modules. Preserve stable bot and logical-conversation IDs separately from physical BB thread IDs. Never infer ownership from titles or writable thread pluginMetadata; SQLite is authoritative. Respect manual Stop and the maintenance setting as specified; do not invent a bot-wide pause or treat idle as authorization.

Update the BOTS task and corresponding specification when implementation diverges. Preserve the separate BOTS-18 core prototype and draft as reference; do not pursue maintainer changes, merge/deploy the fork, or change core, sibling plugins or Radio under the current plugin implementation scope. Follow root verification and draft-PR rules when implementation is released.

## PR review and merge workflow

Matt authorized the same workflow as the Radio thread for Bots PRs once implementation starts: open scoped draft PRs, watch for Devin reviews, fix actionable findings, reply to and resolve addressed review threads, and wait for review on the updated diff when needed. Keep drafts until CI is green and review findings are resolved or explicitly settled. Then mark ready, verify all required checks and merge requirements on the current head, merge, and continue with the next scoped PR. No separate per-PR merge confirmation is needed within this authorized scope. Do not bypass branch protections, dismiss unresolved findings, or treat a missing/pending Devin review as approval. Address other reviewer findings under the repository's normal rules too.

Matt has released implementation. Do not publish a package or expand scope as part of merging unless separately authorized.
