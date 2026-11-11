# Judge task board

Tracker: BB Tasks project `BBP` (bb-plugins), label `judge`. Parent: **BBP-5**. Created 2026-11-10. The board owns execution status; this file maps the build scope. One implementation owner subsequently delivered the sequence with independent reviews; the tracker holds current status and artifacts.

Tasks have explicit dependency keys in their descriptions; the current Tasks CLI does not expose native dependency edges. The dependency map below is the original build order, not a current status list. BBP-6 through BBP-22 implementation PRs have merged. BBP-23 scoped evidence and BBP-24 private package preparation also merged; the tracker distinguishes accepted spike delivery from unverified native/client/host scenarios. Cloudflare is user-deferred, no custom endpoint is available, and publication/collection expansion remain outside the current availability scope.

## Task dependency map

| Task   | Deliverable                                                              | Depends on                     |
| ------ | ------------------------------------------------------------------------ | ------------------------------ |
| BBP-6  | Preserve and deliver the Judge scaffold and build specification          | None                           |
| BBP-7  | Define typed inference contracts and persistent model/run storage        | BBP-6                          |
| BBP-8  | Add GUI secret settings, model management, and privacy resolution        | BBP-7                          |
| BBP-9  | Implement bounded Jev and custom System One transport                    | BBP-8                          |
| BBP-10 | Implement the Workers AI Clef and Clef-flash adapter                     | BBP-8                          |
| BBP-11 | Expose explicit typed asks and model setup through CLI/RPC               | BBP-9, BBP-10                  |
| BBP-12 | User checkpoint: store the Jev key in BB and verify the first live ask   | BBP-11                         |
| BBP-13 | Implement versioned question-set import/export and outcome validation    | BBP-7, BBP-8                   |
| BBP-14 | Implement bounded thread/event sources and verify history/goal semantics | BBP-7, BBP-8                   |
| BBP-15 | Implement environment-scoped Git sources through public plugin RPC       | BBP-7, BBP-8                   |
| BBP-16 | Build the multi-step runner with gates, whole-run budgets and provenance | BBP-13, BBP-14, BBP-15, BBP-11 |
| BBP-17 | Ship three inert templates with cases and copy provenance                | BBP-16                         |
| BBP-18 | Add live case evaluation, model comparison and calibration acceptance    | BBP-17                         |
| BBP-19 | Add bounded response caching and run-history retention                   | BBP-16, BBP-18                 |
| BBP-20 | Implement opt-in event triggers and bounded verdict publication          | BBP-16, BBP-18, BBP-19         |
| BBP-21 | Build Judge settings controls and thread verdict UI                      | BBP-20                         |
| BBP-22 | Add opt-in judge_ask tool and accurate authoring skill                   | BBP-16, BBP-17, BBP-18         |
| BBP-23 | Verify Judge end to end across providers, GUI and remote hosts           | BBP-12, BBP-10, BBP-21, BBP-22 |
| BBP-24 | Prepare verified Judge distribution, documentation and final delivery    | BBP-23                         |

## Credential checkpoint

BBP-12 is the user handoff: after offline ask tests pass and the GUI secret field is ready, the agent tells the user to enter the Jev key directly into BB. It observes sanitized readiness and a synthetic smoke result, never the key. Other work need not wait for credentials. See [spec](SPEC.md#jev-key-setup-and-agent-handoff).

The baseline and lower stages are delivered. Parent attachments preserve the planning documents for provenance; current repository contracts and accepted task clarifications govern continuation. See [live verification](LIVE-VERIFICATION.md) for the remaining external scenarios rather than treating unavailable access as a pass.
