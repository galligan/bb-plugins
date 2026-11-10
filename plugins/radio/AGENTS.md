# Radio

This package currently implements identity and project/channel storage without communication adapters. Read [README.md](README.md) and [the decision ledger](docs/decisions.md) before changing the design or implementing later behavior.

- Preserve the distinction between agreed product decisions, proposed defaults, verified SDK capabilities, and untested delivery compositions.
- Use the terminology and canonical-ID rules in [identity](docs/identity.md) and [protocol](docs/protocol.md). Historical Radio terminology is reference material, not the current contract.
- Keep responsibility and routing separate from thread parentage. Radio records communication; the bot plugin owns collaborator responsibilities and execution policy.
- Preserve explicit stop precedence when designing delivery. A stored transmission or active subscription does not authorize starting a turn.
- Recheck the installed public SDK before implementation. The local BB source checkout and authoring references inspected during research differed from installed declarations.

Keep `bb-plugin-radio` independently buildable using public BB APIs. Implement only the released task scope; the package scaffold does not authorize communication surfaces, live installation or publication.
