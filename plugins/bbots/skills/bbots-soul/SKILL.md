---
name: bbots-soul
description: Deliberately build or revise a persistent Bot's SOUL.md when the user asks to change its standing collaboration style, values or judgment.
---

# Build a Bot's soul

Use this skill when the user asks to establish or change standing persona guidance. Ordinary observations, task findings and maintenance are not authorization to rewrite SOUL.md.

1. Read `bb bot soul show <bot-id> --json`. Preserve the current revision as the edit base.
2. Ask only for missing preferences that materially change the proposal. Cover communication, initiative, disagreement and judgment as relevant to the user's request. Keep task assignments and temporary status out of the soul.
3. Propose the complete Markdown. Apply it when the user's explicit instruction already authorizes that wording or after the user approves the proposal. Record truthful author attribution and the instruction or approval as the reason.
4. Run `bb bot soul update <bot-id> --revision <base> --markdown <complete-markdown> --author <identity> --reason <instruction-or-approval> --json`. Preserve Markdown verbatim; the session limit is 16,000 characters. On a revision conflict, reread and reconcile instead of overwriting another edit.
5. Report the new revision and pending state. Editing starts no turn and does not refresh a live session. Last supplied means the configuration callback returned that revision; applied revision remains unknown without a verified provider receipt. Do not clear, compact, replace or restart a conversation merely to apply a soul edit.

SOUL.md lives in revisioned SQLite. A file with the same name in the bot home is not the authority. A deliberate historical restore must create a new revision through the same checked write path; never rewind executed work or runtime routing.
