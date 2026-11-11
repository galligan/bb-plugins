# Judge

Read [README.md](README.md) and [docs/SPEC.md](docs/SPEC.md) before changing behavior. Repository-wide rules are in the root [AGENTS.md](../../AGENTS.md).

## Tests

- `bun run test` runs `lib/**/*.test.ts` with `node --test`, then `components/**/*.test.tsx` with Vitest and jsdom. Neither needs a running bb, a model provider, or credentials. No inference request runs in tests.
- Test backend behavior under `createFakePluginHost` from `@get-bb/plugin-sdk/testing`. It supplies a real temporary SQLite database; MUST NOT mock storage. Drive `harness.behavior`, read `harness.inspection`, and reload or dispose through `harness.lifecycle`.
- Test settings, the Info row, and thread-row badges in `components/` through `@get-bb/plugin-sdk/testing/app`. `components/test-setup.ts` holds the browser interfaces jsdom lacks; it does not make sizing or position assertions meaningful.
- Go live only for what those cannot show: layout, the compact drawer's placement, host chrome, and real provider calls. [docs/LIVE-VERIFICATION.md](docs/LIVE-VERIFICATION.md) holds dated live evidence; a dated record is not a current guarantee. See [choose the test boundary](../../docs/dev/verification.md#choose-the-test-boundary).
- Credentialed model tests are separate explicit commands and never part of `bun run test`.
