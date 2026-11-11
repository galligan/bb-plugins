# Radio

This package currently implements identity, handle and channel storage, address parsing/resolution and immutable transmission/reply storage and versioned Markdown dispatches and explicit receipt/response facts, commitments, exclusive claims and exact-channel subscriptions/broadcast snapshots and a bounded attention digest with shared local CLI/RPC/native adapters. Trusted-test HTTP is disabled by default and has no outside credentials. An additive reader panel browses project history without acting authority and supports explicit verified thread/operator identity and bounded attention; posting/reply controls retain exact original requests for manual recovery; explicit addressed-recipient responses and bounded response history are available; canonical commitment views and explicit wilco/done/abandon/author-only reopen controls are available; explicit manual channel subscription controls are available; handle editing remains separate. Read [README.md](README.md) and [the decision ledger](docs/decisions.md) before changing the design or implementing later behavior.

- Preserve the distinction between agreed product decisions, proposed defaults, verified SDK capabilities, and untested delivery compositions.
- Use the terminology and canonical-ID rules in [identity](docs/identity.md) and [protocol](docs/protocol.md). Historical Radio terminology is reference material, not the current contract.
- Keep responsibility and routing separate from thread parentage. Radio records communication; the bot plugin owns collaborator responsibilities and execution policy.
- Preserve explicit stop precedence when designing delivery. A stored transmission or active subscription does not authorize starting a turn.
- Recheck the installed public SDK before implementation. The local BB source checkout and authoring references inspected during research differed from installed declarations.

Keep `bb-plugin-radio` independently buildable using public BB APIs. Implement only the released task scope; the package scaffold does not authorize communication surfaces, live installation or publication.
