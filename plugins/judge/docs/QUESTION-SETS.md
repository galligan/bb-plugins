# Question-set definitions

Definitions are global plugin-owned records with `schemaVersion: 1`, a strict ID (1–128 letters/digits/underscore/hyphen, beginning with a letter/digit), and a nonempty description up to4096 characters. Optional settings are `model` (Judge model ID), `projects` (`all`, the default, or1–100 unique project IDs), `budgetMs` (1–30000, default5000), and `calibratedFor` (up to100 unique intended model IDs). The declaration does not confer calibration acceptance. All objects reject unknown fields.

The existing spec example is valid shorthand: top-level `inputs`, `questions` and `outcomes` normalize to one step `main`. A multi-step definition instead declares an ordered `steps` array (1–16), with unique `id`, named `inputs`, `questions`, `outcomes`, optional `model`, and optional `when` on each step. Mixing shorthand and `steps` is invalid. Each step accepts1–64 inputs and1–64 questions; it can declare up to64 outcomes. The set must declare1–64 final outcomes. Questions use the existing strict noul/choice/score contract; no input text is interpolated into instructions.

For shorthand, each top-level outcome becomes a `main` step outcome, and the normalized final outcome refers to it as `main.<name>`. Export always emits this explicit multi-step form. Defaults and normalization are applied before canonical JSON hashing; comments, YAML formatting and map insertion order do not affect the hash. Imported normalized exports round-trip to the same hash. Case fixtures are part of the definition and hash.

## Input selections

Each named input is a strict descriptor with `from` and `maxChars` (1–65536, default12000). The hard UTF-8 ceiling remains64KiB per resolved input. The declared source catalog is:

- `thread.title`, `thread.lastAssistantText`, `thread.commands`, `thread.commandOutput`, `thread.recentUserMessages`, `thread.goal`
- `git.changedFiles`, `git.status`, `git.diff`
- `project.name`, `provider.id`, `provider.model`
- Normalized event fields `event.threadId`, `event.projectId`, `event.requestId`, `event.turnId`, `event.attemptNumber`, `event.inputAccepted`, `event.error`

History sources (`thread.commands`, `thread.commandOutput`, `thread.recentUserMessages`, `thread.goal`) may specify `count` (1–100) and `beforeSeq` (nonnegative integer). Other sources reject these options. Git sources require an explicit `target: uncommitted | branch`; branch selection also requires a nonempty `base` ref up to256 characters, and uncommitted selection rejects `base`. Non-Git sources reject Git options. Source resolution and compatibility verification arrive in their own stages; accepting a descriptor does not claim a live source is implemented.

A set cannot declare a source private/public, downgrade source classification, or invoke arbitrary RPC/actions. Source policy remains outside the definition. Caller source overrides and authored case values remain subject to the runner's privacy checks.

## Expressions and references

Expressions are `{all: [term, ...]}`, `{any: [term, ...]}`, `{not: term}`, a qualified outcome string such as `screen.claimed`, or a typed question predicate. Empty all/any, extra fields and expression depth beyond16 are invalid.

- Noul: `{q: questionId, gte: threshold}` or `lte`, within0–1.
- Choice: `{q: questionId, is: option, gte: threshold}`; the option must be declared, the returned choice must match it, and its distribution probability must meet0–1. Distribution confidence is not the selected probability.
- Score: `{q: questionId, gte: threshold}` or `lte`, within the declared rubric's0..length-1 range, evaluated against the returned fractional expected score.

Step outcomes may reference that step's question IDs and earlier step outcomes. `when` may reference only earlier step outcomes. Final outcomes may reference only step outcomes. Qualified outcome strings are exactly `<step-id>.<outcome-id>`. Unknown questions/outcomes, same-step outcome-to-outcome references, forward references and cycles are rejected before storage. Skipped-step false outcomes are supplied by the runner; missing evidence makes evaluation fail, including beneath negation, rather than producing an actionable true result. All operands are evaluated for evidence presence before all/any reduction.

## Cases and bounds

Up to100 cases can declare optional unique `id`, `inputs`, and `expect`. Every case supplies exactly the declared inputs for every step and every final expected outcome boolean; unknown or missing keys fail import. The canonical form is `inputs: {stepId: {inputName: value}}`. Shorthand definitions also accept flat `inputs: {inputName: value}`. When shorthand can be read as both forms (an input named main whose object looks like a main-step wrapper), import rejects the ambiguity; use the explicit `steps` form to disambiguate. Per-step values are independently bounded JSON, at most64KiB per input. Cases do not read live sources.

The UTF-8 file and exported YAML each cap at256KiB. YAML duplicate keys, aliases, anchors (including unused anchors), custom tags, nonstring mapping keys, multiple documents, unknown fields, nonfinite numbers and non-JSON values are rejected. JSON nesting caps at48 for the fixed definition/case wrappers and16-level expression structures; typed instructions and per-input JSON retain their own existing bounds. YAML parser failures return sanitized definition errors without source excerpts.

## Applicability and mutations

Global scope determines storage ownership. `projects` determines applicability. A project switch defaults on; an explicit false switch makes all saved sets inapplicable for that project. Calls without a project are eligible only for `projects: all`. Explicit ad hoc asks do not consult these saved-set switches. Management lists all global records with applicability flags and bounded ID pagination, so editing/export remains possible when a set cannot execute.

Save/import replaces the named global record and disables dependent triggers in the same SQLite transaction. Remove deletes the definition and disables its triggers. These transactions use the shared cache/calibration invalidation path and notify active consumers after commit. Project-switch edits conservatively disable all triggers and invalidate all local cache/calibration, favoring explicit re-enablement over retaining a potentially stale binding. This is intentional conservative behavior, not a claim of per-project calibration tracking. No acceptance or enabled trigger is inherited by an imported definition. Failed transactions roll back without notifying consumers.

Definitions are revalidated and their hashes checked on read. Corrupt rows fail closed as sanitized persistence errors. The saved-set runner enforces this shared eligibility check before collecting inputs or dispatching inference; management remains available independently of execution eligibility. See [runner behavior](RUNNER.md).
