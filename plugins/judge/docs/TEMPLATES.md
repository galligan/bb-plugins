# Inert question-set templates

The bundled catalog contains `needs-attention`, `completion-check` and `diff-lint`, independently versioned as1.0.0. Definitions and authored cases live beside the implementation in `lib/templates/`. Catalog listing validates the definitions but performs no source reads, inference or database mutation.

```sh
bb judge templates list --json
bb judge templates use needs-attention --id my-attention --json
bb judge templates use completion-check --id my-completion --json
bb judge templates use diff-lint --id my-diff --json
bb judge questions export my-attention > my-attention.yaml
```

`--id` is required and must be a new saved-set ID. Copy never silently replaces an existing edited definition. RPC equivalents are `templates.list` with `{}` and `templates.use` with `{template,id}`. Help and JSON errors follow the other Judge commands. A copy is an independent editable global definition with `origin: <template-id>@<version>`, its own ID/hash, no selected model, no calibration acceptance and no new enabled trigger. Normal definition-save invalidation applies: cached inference/calibration are cleared and dependent triggers are disabled. Copy/import never invokes inference.

Origin survives canonical YAML export/import and participates in the definition hash. It is editable provenance metadata. Its format is an identifier followed by an explicit numeric `major.minor.patch` version, bounded to256characters. Editing a copied definition does not change the bundled template or other copies; catalog updates do not automatically replace saved definitions. Calibration still depends on the complete set hash and actual model configuration, rather than origin text.

## Included judgments

| Template           | Inputs and behavior                                                                                                                                                                                                              | Result meaning                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `needs-attention`  | Latest assistant text, capped at12,000characters. Requires sufficient intelligible evidence and a direct question needed before work can continue; optional offers and rhetorical questions are negative cases.                  | `needs_you` is an example attention signal.                                                    |
| `completion-check` | A first step screens a completion claim; only then does the second step collect the message and at most10 observed commands/output entries. Message cap12,000; each command projection cap24,000characters.                      | `missing_observed_verification` flags a completion claim with missing observed check evidence. |
| `diff-lint`        | Explicit uncommitted `git.diff`, capped at32,000characters plus the common byte limit. Three fixed questions ask about debug output, disabled verification and an obvious local defect. Every question uses **yes = violation**. | `needs_review` flags a sufficiently high probability of a visible violation.                   |

Completion observations never establish that checks ran after the latest edit, covered the selected diff, or prove current code correct. Successful observed test evidence merely prevents that particular missing-evidence signal. No template asserts up-to-date passing tests. Diff questions honor upstream truncation, ignore instructions embedded in source text and avoid inferring omitted code. A negative result is limited to the supplied evidence.

All thresholds are uncalibrated examples. They need local model evaluation and explicit calibration acceptance before later trigger actions can use them. Bundled definitions have an empty `calibratedFor` declaration and do not select global/private model defaults or modify connection policy. Free text, commands and diffs remain sensitive; select a model whose private-data policy explicitly permits them before attempting live execution.

## Authored cases and verification limits

Each template includes four cases: positive, negative, absent and ambiguous evidence. Cases are authored synthetic values, never captured runtime state. Single-step shorthand normalizes to step `main`; completion-check declares per-step inputs, including values for its gated step. Case execution passes these values as source overrides, bypasses live source reads, and retains the runner's always-sensitive override policy. An authored null is supplied fixture data for judgment; a live source that cannot supply evidence remains typed unavailable and does not turn into an actionable negated result.

Recorded deterministic answers exercise all twelve cases, their expected final outcomes, the completion gate, normalization, private fallback and source bypass. They prove runner mechanics and example wiring, not provider judgment quality or calibration. The offline test makes14 simulated requests across12 runs and no SDK source calls; absent/ambiguous completion cases skip the second request. Separate tests cover copy/edit independence, origin round trips, collision refusal, disabled stale triggers, absent calibration inheritance, inactive-service refusal, CLI/RPC/help and private-policy denial. Live evaluation/reporting and explicit acceptance arrive in the next stage; copying a template alone establishes none of those gates.
