import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./fixture.test.ts";
import { documentName } from "./contracts.ts";

test("knowledge revisions use per-record CAS and exact creation replay recovers the corrected state", (t) => {
  const f = fixture(t),
    input = f.input(),
    a = f.memory.create(input).entry;
  assert.equal(a.availability, "available");
  const unrelated = f.memory.create(
    f.input({ topic: "Another note", sources: ["artifact:other"] }),
  ).entry;
  const corrected = f.memory.correct({
    botId: f.bot.botId,
    id: a.id,
    expectedRevision: 1,
    topic: "Preference",
    markdown: "Prefer concise evidence and exact links.",
    basis: "fact",
    sources: ["thread:correction#msg=2"],
    parents: [],
    author: "fixture-user",
    reason: "Explicit correction",
  });
  assert.ok(corrected.availability === "available");
  assert.equal(corrected.revision, 2);
  assert.equal(f.memory.show(f.bot.botId, unrelated.id).revision, 1);
  assert.throws(
    () =>
      f.memory.correct({
        botId: f.bot.botId,
        id: a.id,
        expectedRevision: 1,
        topic: "Preference",
        markdown: "Stale overwrite",
        basis: "fact",
        sources: ["user:stale"],
        parents: [],
        author: "fixture-user",
        reason: "Stale",
      }),
    /changed/,
  );
  const replay = f.memory.create(input);
  assert.equal(replay.replay, true);
  assert.ok(replay.entry.availability === "available");
  assert.equal(replay.entry.record.markdown, corrected.record.markdown);
  assert.throws(
    () => f.memory.create({ ...input, topic: "Different" }),
    /different options/,
  );
});

test("two bots cannot read records, derive from parents or reuse cursors across the boundary", (t) => {
  const f = fixture(t),
    a = f.memory.create(f.input()).entry;
  assert.throws(() => f.memory.show(f.other.botId, a.id), /not found/);
  assert.throws(
    () =>
      f.memory.create(
        f.input({
          botId: f.other.botId,
          sources: [],
          parents: [{ id: a.id, revision: 1 }],
        }),
      ),
    /missing or excluded/,
  );
  assert.throws(
    () => f.memory.search(f.other.botId, { after: a.id }),
    /cursor/,
  );
  assert.deepEqual(f.memory.search(f.other.botId).items, []);
});

test("forgetting suppresses known original sources and derived captures without copying forgotten text into exclusions", (t) => {
  const f = fixture(t),
    body = "Sensitive fixture fact";
  const original = f.input({ markdown: body }),
    a = f.memory.create(original).entry;
  const b = f.memory.create(
    f.input({
      kind: "summary",
      sources: [],
      parents: [{ id: a.id, revision: 1 }],
      boundary: {
        streamId: "thread:original",
        from: 1,
        through: 3,
        expectedRevision: 0,
      },
    }),
  ).entry;
  const c = f.memory.create(
    f.input({ sources: [], parents: [{ id: b.id, revision: 1 }] }),
  ).entry;
  const shared = f.memory.create(
    f.input({ markdown: "Another fact from the known same source" }),
  ).entry;
  f.memory.forget(f.bot.botId, a.id, 1, "fixture-user");
  for (const entry of [a, b, c, shared]) {
    const found = f.memory.show(f.bot.botId, entry.id);
    assert.equal(found.availability, "suppressed");
    assert.equal("record" in found, false);
  }
  assert.deepEqual(f.memory.search(f.bot.botId).items, []);
  assert.deepEqual(f.memory.search(f.bot.botId, { kind: "summary" }).items, []);
  assert.equal(f.memory.create(original).entry.availability, "suppressed");
  assert.throws(() => f.memory.create(f.input()), /excluded/);
  assert.equal(
    f.memory.create(
      f.input({ markdown: body, sources: ["thread:independent#msg=9"] }),
    ).entry.availability,
    "available",
  );
  const excluded = f.db.prepare("SELECT * FROM memory_exclusions").all();
  assert.equal(JSON.stringify(excluded).includes(body), false);
  assert.equal(
    f.memory.progress(f.bot.botId, "thread:original", "summary").through,
    3,
  );
});

test("known historical provenance remains excluded after correction or restoring an older selected revision", (t) => {
  const f = fixture(t),
    a = f.memory.create(f.input()).entry;
  const current = f.memory.correct({
    botId: f.bot.botId,
    id: a.id,
    expectedRevision: 1,
    topic: "Preference",
    markdown: "Corrected text",
    basis: "fact",
    sources: ["artifact:correction"],
    parents: [],
    author: "fixture-user",
    reason: "Correction",
  });
  const sameSource = f.memory.create(f.input()).entry;
  f.memory.forget(f.bot.botId, sameSource.id, 1, "fixture-user");
  assert.equal(f.memory.show(f.bot.botId, a.id).availability, "suppressed");
  const doc = f.setup.documents.get(f.bot.botId, documentName(a.id))!;
  // Simulates only an old selected document revision; operational exclusions stay intact.
  f.db.prepare("UPDATE documents SET revision=1 WHERE id=?").run(doc.id);
  assert.equal(f.memory.show(f.bot.botId, a.id).availability, "suppressed");
  assert.throws(
    () =>
      f.memory.correct({
        botId: f.bot.botId,
        id: a.id,
        expectedRevision: 1,
        topic: "Preference",
        markdown: "Stale resurrection",
        basis: "fact",
        sources: ["artifact:correction"],
        parents: [],
        author: "fixture-user",
        reason: "Restore",
      }),
    /Excluded/,
  );
  assert.equal(current.revision, 2);
});

test("derived inference cannot become fact and stale or excluded parents cannot admit a new result", (t) => {
  const f = fixture(t),
    a = f.memory.create(f.input({ basis: "inference" })).entry;
  assert.throws(
    () =>
      f.memory.create(
        f.input({ sources: [], parents: [{ id: a.id, revision: 1 }] }),
      ),
    /inference/,
  );
  assert.throws(
    () =>
      f.memory.create(
        f.input({
          basis: "inference",
          sources: [],
          parents: [{ id: a.id, revision: 2 }],
        }),
      ),
    /changed/,
  );
  f.memory.forget(f.bot.botId, a.id, 1, "fixture-user");
  assert.throws(
    () =>
      f.memory.create(
        f.input({
          basis: "inference",
          sources: [],
          parents: [{ id: a.id, revision: 1 }],
        }),
      ),
    /excluded/,
  );
});

test("retrieval is bounded, searches literal wildcard characters and paginates stably across arrivals", (t) => {
  const f = fixture(t);
  for (let n = 0; n < 25; n++)
    f.memory.create(
      f.input({
        topic: `Note ${n}`,
        markdown: n === 0 ? "100% complete" : `Evidence ${n}`,
        sources: [`artifact:note-${n}`],
      }),
    );
  const first = f.memory.search(f.bot.botId, { limit: 20 });
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  f.memory.create(f.input({ sources: ["artifact:new-arrival"] }));
  const next = f.memory.search(f.bot.botId, {
    after: first.nextCursor,
    limit: 20,
  });
  assert.equal(next.items.length, 5);
  assert.equal(next.nextCursor, null);
  assert.equal(
    new Set([...first.items, ...next.items].map((x) => x.id)).size,
    25,
  );
  assert.equal(f.memory.search(f.bot.botId, { query: "%" }).items.length, 1);
  assert.throws(() => f.memory.search(f.bot.botId, { limit: 21 }));
});

test("in-turn capture commits boundary and record together; replay after later progress never rewinds it", (t) => {
  const f = fixture(t),
    input = f.input({
      kind: "summary",
      boundary: {
        streamId: "thread:range",
        from: 1,
        through: 4,
        expectedRevision: 0,
      },
    });
  f.db.exec(
    "CREATE TRIGGER fail_capture BEFORE INSERT ON documents WHEN NEW.name GLOB 'CAPTURE:*' BEGIN SELECT RAISE(ABORT,'injected progress failure'); END",
  );
  assert.throws(() => f.memory.create(input), /injected/);
  assert.equal(
    f.memory.progress(f.bot.botId, "thread:range", "summary").through,
    0,
  );
  assert.equal(
    f.memory.search(f.bot.botId, { kind: "summary" }).items.length,
    0,
  );
  f.db.exec("DROP TRIGGER fail_capture");
  const captured = f.memory.create(input);
  assert.equal(captured.progress?.through, 4);
  assert.throws(
    () =>
      f.memory.create(
        f.input({
          kind: "summary",
          boundary: {
            streamId: "thread:range",
            from: 6,
            through: 8,
            expectedRevision: 1,
          },
        }),
      ),
    /skips/,
  );
  f.memory.create(
    f.input({
      kind: "summary",
      boundary: {
        streamId: "thread:range",
        from: 5,
        through: 8,
        expectedRevision: 1,
      },
    }),
  );
  assert.equal(f.memory.create(input).progress?.through, 8);
  assert.equal(
    f.memory.progress(f.bot.botId, "thread:range", "summary").revision,
    2,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});
