import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixture.test.ts";

test("an unused capture kind consumes only excluded input before later disjoint capture; replay never rewinds", (t) => {
  const f = fixture(t),
    streamId = "thread:stream";
  const state = f.memory.create(
    f.input({
      kind: "state",
      sources: [],
      boundary: { streamId, from: 1, through: 3, expectedRevision: 0 },
    }),
  ).entry;
  f.memory.forget(f.bot.botId, state.id, 1, "fixture-user");
  const input = f.input({
    kind: "summary",
    sources: [],
    boundary: { streamId, from: 4, through: 6, expectedRevision: 0 },
  });
  const saved = f.memory.create(input);
  assert.equal(saved.entry.availability, "available");
  assert.deepEqual(saved.progress, {
    revision: 1,
    through: 6,
    recordId: saved.entry.id,
    excludedBefore: { from: 1, through: 3 },
  });
  const later = f.memory.create(
    f.input({
      kind: "summary",
      sources: [],
      boundary: { streamId, from: 7, through: 8, expectedRevision: 1 },
    }),
  );
  const replay = f.memory.create(input);
  assert.equal(replay.replay, true);
  assert.equal(replay.entry.id, saved.entry.id);
  assert.deepEqual(replay.progress, later.progress);
  assert.equal(f.memory.show(f.bot.botId, state.id).availability, "suppressed");
  assert.equal(f.memory.search(f.bot.botId, { kind: "state" }).items.length, 0);
});

test("partially advanced kinds can cross excluded prefixes, with no stale-cursor or cross-bot bypass", (t) => {
  const f = fixture(t),
    streamId = "thread:stream";
  const first = f.memory.create(
    f.input({
      kind: "summary",
      sources: [],
      boundary: { streamId, from: 1, through: 2, expectedRevision: 0 },
    }),
  ).entry;
  const state = f.memory.create(
    f.input({
      kind: "state",
      sources: [],
      boundary: { streamId, from: 1, through: 5, expectedRevision: 0 },
    }),
  ).entry;
  f.memory.forget(f.bot.botId, state.id, 1, "fixture-user");
  const input = f.input({
    kind: "summary",
    sources: [],
    boundary: { streamId, from: 6, through: 8, expectedRevision: 0 },
  });
  assert.throws(() => f.memory.create(input), /boundary changed/);
  assert.throws(
    () => f.memory.create({ ...input, botId: f.other.botId }),
    /skips unprocessed/,
  );
  assert.ok(input.kind !== "knowledge");
  const saved = f.memory.create({
    ...input,
    boundary: { ...input.boundary, expectedRevision: 1 },
  });
  assert.equal(saved.entry.availability, "available");
  assert.deepEqual(saved.progress?.excludedBefore, { from: 3, through: 5 });
  assert.equal(f.memory.show(f.bot.botId, first.id).availability, "suppressed");
});

test("coverage unions adjacent excluded intervals but refuses an unexcluded hole or another stream", (t) => {
  const f = fixture(t),
    streamId = "thread:stream";
  for (const [from, through] of [
    [1, 2],
    [4, 5],
  ] as const) {
    const note = f.memory.create(
      f.input({
        sources: Array.from(
          { length: through - from + 1 },
          (_, i) => `${streamId}#msg=${from + i}`,
        ),
      }),
    ).entry;
    f.memory.forget(f.bot.botId, note.id, 1, "fixture-user");
  }
  const input = f.input({
    kind: "summary",
    sources: [],
    boundary: { streamId, from: 6, through: 8, expectedRevision: 0 },
  });
  assert.throws(() => f.memory.create(input), /skips unprocessed/);
  assert.equal(f.memory.progress(f.bot.botId, streamId, "summary").revision, 0);
  const hole = f.memory.create(
    f.input({ sources: [`${streamId}#msg=3`] }),
  ).entry;
  f.memory.forget(f.bot.botId, hole.id, 1, "fixture-user");
  assert.throws(
    () =>
      f.memory.create(
        f.input({
          kind: "summary",
          sources: [],
          boundary: {
            streamId: "thread:other",
            from: 6,
            through: 8,
            expectedRevision: 0,
          },
        }),
      ),
    /skips unprocessed/,
  );
  const saved = f.memory.create(input);
  assert.equal(saved.entry.availability, "available");
  assert.deepEqual(saved.progress?.excludedBefore, { from: 1, through: 5 });
});
