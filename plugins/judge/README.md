# Judge

Judge is a planned headless-first BB plugin for typed judgments over application state, reusable question sets, and optional event-driven verdicts.

**Status: preparation scaffold, not a working decision service.** The backend only logs that it loaded. It registers no commands, tools, settings, event handlers, database, or model connections. It is not advertised in the repository's install collection.

## Build briefing

- [Implementation spec](docs/SPEC.md) is the current contract and supersedes the original proposal where they differ.
- [BB compatibility review](docs/COMPATIBILITY.md) records verified contracts, corrections, evidence, and remaining checks.
- [Task board map](docs/TASKS.md) links the BBP parent and all implementation tasks, including the Jev key checkpoint.
- [Implementation plan](docs/IMPLEMENTATION.md) divides the work into independently verifiable stages.
- [Original proposal](docs/original-proposal.txt) preserves the supplied text unchanged for provenance, not as implementation authority.

## Development

Use the repository's pinned Bun 1.3.14. Install dependencies once at the repository root with `bun install`. From this directory, run `bun run check` and `bun run build`. Builds use the package-local `bb-app@0.49.0` toolchain and public `@get-bb/plugin-sdk@0.6.132` declarations. No generated declarations or `dist/` files are committed. `skipLibCheck` skips dependency declaration internals; plugin source remains strictly checked.

Before pushing, run the root formatting, lint, check, test, and build commands documented in [CONTRIBUTING.md](../../CONTRIBUTING.md). Add the package's test script with the first behavioral implementation; there is no behavior test suite for this inert scaffold.

Do not install this scaffold to evaluate inference. The first usable milestone is an explicit CLI/RPC request to a configured model, with privacy enforcement, bounded requests, and deterministic transport tests.
