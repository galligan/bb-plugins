import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeName, NAME_PATTERN } from "./names.ts";

test("name repair uses single hyphens and reports the actual spelling", () => {
  for (const requested of [
    "Agent__Name",
    "agent--name",
    "  Agent --- Name  ",
    "agent.name",
  ])
    assert.deepEqual(normalizeName(requested), {
      requested,
      name: "agent-name",
      corrected: true,
    });
  assert.deepEqual(normalizeName("agent-name"), {
    requested: "agent-name",
    name: "agent-name",
    corrected: false,
  });
  assert.equal(normalizeName("Équipe ２").name, "equipe-2");
  for (const candidate of ["a", "123", "a_b--c", "-a-", "@USER", "ｃｈ"])
    assert.match(normalizeName(candidate).name, NAME_PATTERN);
});

test("name repair refuses empty and oversized results without truncation", () => {
  for (const candidate of ["", "---", "💬", "a".repeat(65), "a".repeat(257)])
    assert.throws(() => normalizeName(candidate));
  assert.equal(normalizeName("a".repeat(64)).name.length, 64);
});
