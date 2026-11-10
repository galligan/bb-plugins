# Plugin development

This directory records development patterns and lessons shared by the plugins in this repository. Package-specific rules remain in each plugin's `AGENTS.md`; contribution and distribution policy remains in [CONTRIBUTING.md](../../CONTRIBUTING.md).

| When working on…                                                      | Read                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| SDK calls, host execution, RPC, or UI surfaces                        | [Plugin patterns](plugin-patterns.md)                                       |
| UI/UX, component reuse, navigation, accessibility, or visual review   | [Plugin UI and UX](ui-ux.md) and [research references](ui-ux-references.md) |
| Environment creation, retirement, cancellation, or filesystem removal | [Lifecycle and data preservation](lifecycle.md)                             |
| Tests, SDK upgrades, builds, or a live development loop               | [Verification](verification.md)                                             |
| Downloaded plugin examples and worktree setup                         | [Reference plugins](../../README.md#reference-plugins)                      |
| Release sources and automatic plugin labels                           | [Contribution guide](../../CONTRIBUTING.md)                                 |

The initial guidance was checked against this repository and the installed `bb-plugin-authoring` references on 2026-11-10. Package SDK versions differ: an example demonstrates a pattern, not a guarantee that its API names work with every plugin's pin. Use the current public SDK declarations and [BB Plugin Guide](https://getbb.app/plugin-guide) when implementing an API change.

When adding a lesson, include its trigger, the behavior to preserve, and a source or regression test. Keep temporary investigation notes and unverified hypotheses out of the defaults. Mark historical verification as historical rather than turning an old test result into a current guarantee.
