import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openCommitments } from "../commitments/store.ts";
import { fixture, attribution } from "./restore-fixture.ts";

test("selected restore appends revisions and preserves completed commitments, task state, captures, native/home identities and later notes", async (t) => {
  const f = fixture(t),
    botId = f.bot.botId;
  f.setup.setHome(botId, "/tmp/bbots-fixture/home");
  f.setup.conversations.bindInitialThread(f.bot.conversationId, "thr_fixture");
  const note = f.memory.create(f.input()).entry;
  const commitments = openCommitments(f.bb.storage, f.setup, () => {});
  const obligation = commitments.add(
    botId,
    {
      requestId: randomUUID(),
      ownerConversationId: f.bot.conversationId,
      what: "Finish fixture",
      evidence: [],
      reference: { kind: "unlinked", status: "open" },
    },
    attribution,
  );
  const id = f.checkpoint();
  const closed = commitments.close(botId, obligation.id, 1, attribution);
  const task = f.setup.documents.write({
    botId,
    name: "TASKS.json",
    expectedRevision: 0,
    markdown: '{"completed":true}',
    ...attribution,
  });
  f.memory.create(
    f.input({
      kind: "summary",
      boundary: {
        streamId: "thread:fixture",
        from: 1,
        through: 3,
        expectedRevision: 0,
      },
    }),
  );
  const cursor = f.memory.progress(botId, "thread:fixture", "summary");
  const later = f.memory.create(
    f.input({
      sources: ["artifact:later"],
      markdown: "Added after checkpoint",
    }),
  ).entry;
  f.setup.profiles.rename({
    botId,
    expectedRevision: 1,
    name: "Different",
    ...attribution,
  });
  f.soul.update({
    botId,
    expectedRevision: 1,
    markdown: "Later soul",
    ...attribution,
  });
  f.memory.correct({
    botId,
    id: note.id,
    expectedRevision: 1,
    topic: "Changed",
    markdown: "Later note",
    sources: ["artifact:correction"],
    parents: [],
    basis: "fact",
    ...attribution,
  });
  const originalHome = f.setup.get(botId),
    originalMain = f.setup.conversations.get(f.bot.conversationId);
  const restored = await f.restore(
    f.request(id, [
      { kind: "profile", expectedRevision: 2 },
      { kind: "soul", expectedRevision: 2 },
      { kind: "knowledge", id: note.id, expectedRevision: 2 },
      { kind: "execution", expectedRevision: 0 },
    ]),
  );
  assert.equal(restored.replay, false);
  assert.equal(f.setup.profiles.get(botId).name, "Bob");
  assert.equal(f.setup.profiles.get(botId).revision, 3);
  assert.equal(f.soul.show(botId).current?.revision, 3);
  assert.equal(f.soul.show(botId).appliedRevision, null);
  assert.equal(
    f.soul.show(botId).current?.markdown,
    f.setup.documents.revision(botId, "SOUL.md", 1).markdown,
  );
  assert.equal(f.soul.defaults(botId).revision, 1);
  const found = f.memory.show(botId, note.id);
  assert.ok(found.availability === "available");
  assert.equal(found.revision, 3);
  assert.equal(found.record.markdown, "Prefer concise evidence.");
  assert.equal(found.author, attribution.author);
  assert.deepEqual(commitments.get(botId, obligation.id), closed);
  assert.deepEqual(f.setup.documents.get(botId, "TASKS.json"), task);
  assert.deepEqual(
    f.memory.progress(botId, "thread:fixture", "summary"),
    cursor,
  );
  assert.equal(f.memory.show(botId, later.id).availability, "available");
  assert.deepEqual(f.setup.get(botId), originalHome);
  assert.deepEqual(
    f.setup.conversations.get(f.bot.conversationId),
    originalMain,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("a stale selected revision rolls back every earlier write and receipt", async (t) => {
  const f = fixture(t),
    id = f.checkpoint(),
    botId = f.bot.botId;
  f.setup.profiles.rename({
    botId,
    expectedRevision: 1,
    name: "Current",
    ...attribution,
  });
  const request = f.request(id, [
    { kind: "profile", expectedRevision: 2 },
    { kind: "soul", expectedRevision: 0 },
  ]);
  await assert.rejects(f.restore(request), /changed/);
  assert.equal(f.setup.profiles.get(botId).revision, 2);
  assert.equal(f.setup.profiles.get(botId).name, "Current");
  assert.equal(
    f.setup.documents.get(botId, `RESTORE:${request.requestId}.json`),
    null,
  );
  request.selection[1]!.expectedRevision = 1;
  const saved = await f.restore(request);
  assert.equal(saved.receipt.writes.length, 2);
  assert.equal(f.setup.profiles.get(botId).revision, 3);
});

test("exact restore replay never repeats writes after later correction/forget, and changed options refuse", async (t) => {
  const f = fixture(t),
    note = f.memory.create(f.input()).entry;
  const request = f.request(f.checkpoint(), [
    { kind: "knowledge", id: note.id, expectedRevision: 1 },
  ]);
  const saved = await f.restore(request);
  f.memory.correct({
    botId: f.bot.botId,
    id: note.id,
    expectedRevision: 2,
    topic: "Later",
    markdown: "Later text",
    basis: "fact",
    sources: ["artifact:later"],
    parents: [],
    ...attribution,
  });
  f.memory.forget(f.bot.botId, note.id, 3, attribution.author);
  const replay = await f.restore(request);
  assert.equal(replay.replay, true);
  assert.deepEqual(replay.receipt, saved.receipt);
  assert.equal(f.memory.show(f.bot.botId, note.id).revision, 3);
  assert.equal(f.memory.show(f.bot.botId, note.id).availability, "suppressed");
  assert.equal(JSON.stringify(replay.receipt).includes("Later text"), false);
  await assert.rejects(
    f.restore({ ...request, reason: "Different" }),
    /different options/,
  );
});

test("a newer tombstone blocks selected historical knowledge and rolls back other selected changes", async (t) => {
  const f = fixture(t),
    note = f.memory.create(f.input()).entry,
    id = f.checkpoint();
  f.memory.forget(f.bot.botId, note.id, 1, attribution.author);
  await assert.rejects(
    f.restore(
      f.request(id, [
        { kind: "soul", expectedRevision: 1 },
        { kind: "knowledge", id: note.id, expectedRevision: 1 },
      ]),
    ),
    /excluded/,
  );
  assert.equal(f.soul.show(f.bot.botId).current?.revision, 1);
  assert.equal(f.memory.show(f.bot.botId, note.id).availability, "suppressed");
});

test("explicit restore retains historical parent revisions while ordinary correction still requires current evidence", async (t) => {
  const f = fixture(t),
    parent = f.memory.create(f.input()).entry;
  const child = f.memory.create(
    f.input({ sources: [], parents: [{ id: parent.id, revision: 1 }] }),
  ).entry;
  const id = f.checkpoint(),
    botId = f.bot.botId;
  f.memory.correct({
    botId,
    id: parent.id,
    expectedRevision: 1,
    topic: "Changed",
    markdown: "Changed parent",
    basis: "fact",
    sources: ["artifact:later"],
    parents: [],
    ...attribution,
  });
  const correction = {
    botId,
    id: child.id,
    expectedRevision: 1,
    topic: "Changed",
    markdown: "Changed child",
    basis: "fact" as const,
    sources: [],
    parents: [{ id: parent.id, revision: 1 }],
    ...attribution,
  };
  assert.throws(() => f.memory.correct(correction), /parent changed/);
  f.memory.correct({
    ...correction,
    parents: [{ id: parent.id, revision: 2 }],
  });
  await f.restore(
    f.request(id, [{ kind: "knowledge", id: child.id, expectedRevision: 2 }]),
  );
  const found = f.memory.show(botId, child.id);
  assert.ok(found.availability === "available");
  assert.equal(found.revision, 3);
  assert.deepEqual(found.record.parents, [{ id: parent.id, revision: 1 }]);
  f.memory.forget(botId, parent.id, 2, attribution.author);
  assert.equal(f.memory.show(botId, child.id).availability, "suppressed");
});

test("receipt failure, unsupported selections and another bot's checkpoint leave records unchanged", async (t) => {
  const f = fixture(t),
    id = f.checkpoint();
  f.db.exec(
    "CREATE TRIGGER fail_restore BEFORE INSERT ON document_revisions WHEN (SELECT name FROM documents WHERE id=NEW.document_id) GLOB 'RESTORE:*' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END",
  );
  await assert.rejects(
    f.restore(f.request(id, [{ kind: "soul", expectedRevision: 1 }])),
    /receipt failure/,
  );
  assert.equal(f.soul.show(f.bot.botId).current?.revision, 1);
  f.db.exec("DROP TRIGGER fail_restore");
  const request = f.request(id, [{ kind: "soul", expectedRevision: 1 }]);
  await assert.rejects(
    f.restore({ ...request, botId: f.other.botId }),
    /not found/,
  );
  await assert.rejects(
    f.restore({
      ...request,
      selection: [request.selection[0]!, request.selection[0]!],
    }),
    /only once/,
  );
});
