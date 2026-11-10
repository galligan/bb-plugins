# Radio

This directory currently contains design documents only. Read [README.md](README.md) and [the decision ledger](docs/decisions.md) before changing the design or beginning separately authorized implementation.

- Preserve the distinction between agreed product decisions, proposed defaults, verified SDK capabilities, and untested delivery compositions.
- Use the terminology and canonical-ID rules in [identity](docs/identity.md) and [protocol](docs/protocol.md). Historical Radio terminology is reference material, not the current contract.
- Keep responsibility and routing separate from thread parentage. Radio records communication; the bot plugin owns collaborator responsibilities and execution policy.
- Preserve explicit stop precedence when designing delivery. A stored transmission or active subscription does not authorize starting a turn.
- Recheck the installed public SDK before implementation. The local BB source checkout and authoring references inspected during research differed from installed declarations.

Future implementation belongs in an independently buildable `bb-plugin-radio` package using public BB APIs. Do not add a runtime or publish this design placeholder merely to make it resemble an implemented package.
