# Judge

Judge is a planned headless-first BB plugin for typed judgments over application state, reusable question sets, and optional event-driven verdicts.

**Status: contracts and storage foundation, not yet a working decision service.** Offline modules validate requests, complete provider response batches, model records, and verdicts. The SQLite repository provides append-only migrations, atomic run/step writes, reload persistence, bounded history, and sanitized persistence failures. The backend still only logs that it loaded; these modules are not registered as runtime capabilities yet. It is not advertised in the repository's install collection.

Validation covers noul probabilities, choice distributions, fractional expected scores with their submitted rubric, structured JSON instructions, nullable input-token usage, and distinct ad hoc/saved-set identities. JSON must be finite and lossless, with depth 16, up to 64 questions/named inputs, 64 KiB per input, 256 KiB per complete request, and 1 MiB per provider response. The fixed verdict envelope permits two extra nesting levels so accepted structured provider answers can round-trip through storage. Dynamic schema maps explicitly reject reserved `__proto__` keys; arbitrary state and structured instruction objects preserve their JSON keys. Definitions and step execution arrive in later stages. Models default to disallowing private input; secret values and request state have no repository fields. Direct answers can be sensitive and remain in bounded run records, not thread metadata.

Run history is capped at 30 days and 10,000 entries, pruned during successful writes with dependent step rows. Stored steps retain execution order independently of their IDs. History reads return at most 100 records and use timestamp/ID cursors to preserve entries sharing a timestamp. Persistence failure is an operational error; callers must not publish actions when a run cannot be recorded.

## Build briefing

- [Implementation spec](docs/SPEC.md) is the current contract and supersedes the original proposal where they differ.
- [BB compatibility review](docs/COMPATIBILITY.md) records verified contracts, corrections, evidence, and remaining checks.
- [Task board map](docs/TASKS.md) links the BBP parent and all implementation tasks, including the Jev key checkpoint.
- [Implementation plan](docs/IMPLEMENTATION.md) divides the work into independently verifiable stages.
- [Original proposal](docs/original-proposal.txt) preserves the supplied text unchanged for provenance, not as implementation authority.

## Development

Use the repository's pinned Bun 1.3.14. Install dependencies once at the repository root with `bun install`. From this directory, run `bun run check` and `bun run build`. Builds use the package-local `bb-app@0.49.0` toolchain and public `@get-bb/plugin-sdk@0.6.132` declarations. No generated declarations or `dist/` files are committed. `skipLibCheck` skips dependency declaration internals; plugin source remains strictly checked.

Before pushing, run the root formatting, lint, check, test, and build commands documented in [CONTRIBUTING.md](../../CONTRIBUTING.md). `bun run test` runs the deterministic Node suite; storage tests use the public SDK fake host with its real SQLite peer. No inference requests run in tests. The package also checks that its imports use the public SDK surface.

Do not install this scaffold to evaluate inference. The first usable milestone is an explicit CLI/RPC request to a configured model, with privacy enforcement, bounded requests, and deterministic transport tests.
