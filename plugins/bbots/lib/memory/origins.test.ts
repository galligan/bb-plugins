import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixture.test.ts";

test("padded stream lookup recovers the same durable cursor", (t) => {
  const f = fixture(t);
  f.memory.create(
    f.input({
      kind: "summary",
      boundary: {
        streamId: "thread:stream",
        from: 1,
        through: 3,
        expectedRevision: 0,
      },
    }),
  );
  assert.deepEqual(
    f.memory.progress(f.bot.botId, " thread:stream ", "summary"),
    f.memory.progress(f.bot.botId, "thread:stream", "summary"),
  );
});

test("remember, capture and correction preserve complete Markdown whitespace", (t) => {
  const f = fixture(t),
    markdown = "\n    print('literal code')\n\n",
    replacement = "\tcorrected code\n\n";
  for (const kind of ["knowledge", "summary"]) {
    const saved = f.memory.create(
      f.input({
        kind,
        markdown,
        ...(kind === "summary"
          ? {
              boundary: {
                streamId: "thread:stream",
                from: 1,
                through: 2,
                expectedRevision: 0,
              },
            }
          : {}),
      }),
    ).entry;
    assert.ok(saved.availability === "available");
    assert.equal(saved.record.markdown, markdown);
    const corrected = f.memory.correct({
      botId: f.bot.botId,
      id: saved.id,
      expectedRevision: 1,
      topic: "Code",
      markdown: replacement,
      basis: "fact",
      sources: ["artifact:corrected"],
      parents: [],
      author: "fixture-user",
      reason: "Explicit correction",
    });
    assert.ok(corrected.availability === "available");
    assert.equal(corrected.record.markdown, replacement);
  }
});

test("capture stream and inherited coverage cannot be omitted to bypass a forgotten original source", (t) => {
  const f = fixture(t);
  const original = f.memory.create(
    f.input({ sources: ["thread:secret"] }),
  ).entry;
  const captured = f.memory.create(
    f.input({
      kind: "summary",
      sources: ["artifact:unrelated"],
      boundary: {
        streamId: "thread:secret",
        from: 1,
        through: 3,
        expectedRevision: 0,
      },
    }),
  ).entry;
  const derived = f.memory.create(
    f.input({ sources: [], parents: [{ id: captured.id, revision: 1 }] }),
  ).entry;
  f.memory.forget(f.bot.botId, original.id, 1, "fixture-user");
  assert.equal(
    f.memory.show(f.bot.botId, captured.id).availability,
    "suppressed",
  );
  assert.equal(
    f.memory.show(f.bot.botId, derived.id).availability,
    "suppressed",
  );
  assert.deepEqual(f.memory.search(f.bot.botId, { kind: "summary" }).items, []);
  assert.throws(
    () =>
      f.memory.create(
        f.input({
          kind: "summary",
          sources: ["artifact:other"],
          boundary: {
            streamId: "thread:secret",
            from: 4,
            through: 6,
            expectedRevision: 1,
          },
        }),
      ),
    /excluded/,
  );
  assert.equal(
    f.memory.progress(f.bot.botId, "thread:secret", "summary").through,
    3,
  );
});

test("forgetting a capture covers overlapping windows and native messages but permits later disjoint input", (t) => {
  const f = fixture(t),
    streamId = "thread:stream";
  const state = f.memory.create(
    f.input({
      kind: "state",
      sources: ["thread:stream#msg=1"],
      boundary: { streamId, from: 1, through: 3, expectedRevision: 0 },
    }),
  ).entry;
  f.memory.create(
    f.input({
      kind: "summary",
      sources: ["artifact:first"],
      boundary: { streamId, from: 1, through: 1, expectedRevision: 0 },
    }),
  );
  const overlap = f.memory.create(
    f.input({
      kind: "summary",
      sources: ["artifact:overlap"],
      boundary: { streamId, from: 2, through: 4, expectedRevision: 1 },
    }),
  ).entry;
  const derived = f.memory.create(
    f.input({ sources: [], parents: [{ id: overlap.id, revision: 1 }] }),
  ).entry;
  f.memory.forget(f.bot.botId, state.id, 1, "fixture-user");
  assert.equal(
    f.memory.show(f.bot.botId, overlap.id).availability,
    "suppressed",
  );
  assert.equal(
    f.memory.show(f.bot.botId, derived.id).availability,
    "suppressed",
  );
  assert.throws(
    () => f.memory.create(f.input({ sources: ["thread:stream#msg=2"] })),
    /excluded/,
  );
  const next = f.memory.create(
    f.input({
      kind: "summary",
      sources: ["thread:stream#msg=5"],
      boundary: { streamId, from: 5, through: 6, expectedRevision: 2 },
    }),
  ).entry;
  assert.equal(next.availability, "available");
  assert.equal(f.memory.progress(f.bot.botId, streamId, "summary").through, 6);
  assert.throws(
    () => f.memory.progress(f.bot.botId, "thread:stream#msg=2", "summary"),
    /whole thread/,
  );
});
