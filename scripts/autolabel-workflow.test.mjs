import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { YAML } from "bun";

test("autolabel loads its script from the default branch even for older stack bases", () => {
  const workflow = YAML.parse(
    readFileSync(
      new URL("../.github/workflows/autolabel.yml", import.meta.url),
      "utf8",
    ),
  );
  const checkout = workflow.jobs.autolabel.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );

  // PR base SHAs can predate the script; PR head code must never supply it.
  assert.equal(
    checkout.with.ref,
    "${{ github.event.repository.default_branch }}",
  );
});
