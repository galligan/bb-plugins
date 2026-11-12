import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture, attribution } from "./fixture.test.ts";

test("main and worker preparations pin checkpoints and only their own captures, preserving distinct parent/report contracts", async (t) => {
  const f = fixture(t);
  const main = f.note({
    kind: "summary",
    sources: [],
    markdown: "Private main state",
    boundary: {
      streamId: "thread:thr_main",
      from: 1,
      through: 3,
      expectedRevision: 0,
    },
  }).entry;
  const worker = f.note({
    kind: "state",
    sources: [],
    markdown: "Private worker state",
    boundary: {
      streamId: "thread:thr_worker",
      from: 1,
      through: 2,
      expectedRevision: 0,
    },
  }).entry;
  const knowledge = f.note({ markdown: "Private durable note" }).entry;
  for (const conversationId of [
    f.bot.conversationId,
    f.worker.conversationId,
  ]) {
    const prepared = await f.continuity.prepare(f.request(conversationId));
    const shown = await f.continuity.show(f.bot.botId, prepared.id);
    assert.equal(shown.phase, "prepared-references-only");
    assert.equal(shown.safeToExecuteTransition, false);
    assert.equal(shown.appliedSoulRevision, null);
    assert.equal(
      shown.currentReadiness,
      "not-evaluated-use-continuity-readiness",
    );
    assert.equal(shown.knowledge[0]?.id, knowledge.id);
    assert.equal(shown.captures.length, 1);
    assert.equal(
      shown.captures[0]?.id,
      conversationId === f.bot.conversationId ? main.id : worker.id,
    );
    assert.equal(
      shown.role,
      conversationId === f.bot.conversationId ? "main" : "worker",
    );
    if (shown.role === "worker") {
      assert.equal(shown.contractRevision, 1);
      assert.equal(shown.historicalObservation.parentThreadId, "thr_parent");
      assert.deepEqual(shown.currentContract?.agreement.reportTo, {
        kind: "thread",
        threadId: "thr_monitor",
      });
    }
    const stored = f.store.documents.get(
      f.bot.botId,
      `CONTINUITY:${prepared.id.slice(4)}.json`,
    )!;
    for (const text of [
      "Private durable note",
      "Private main state",
      "Private worker state",
    ])
      assert.equal(stored.markdown.includes(text), false);
    assert.equal(
      f.checkpoints.show(f.bot.botId, prepared.checkpointId).selectedDocuments,
      2,
    );
  }
  assert.equal(f.harness.inspection.sdk.calls.length, 8);
  assert.ok(
    f.harness.inspection.sdk.calls.every((call) =>
      [
        "threads.get",
        "threads.context",
        "threads.events.list",
        "threads.queuedMessages.list",
      ].includes(call.path),
    ),
  );
});

test("forgetting filters saved knowledge and derived capture references without consulting or copying old bodies", async (t) => {
  const f = fixture(t),
    original = f.note().entry;
  const derived = f.note({
    kind: "summary",
    sources: [],
    parents: [{ id: original.id, revision: 1 }],
    boundary: {
      streamId: "thread:thr_main",
      from: 1,
      through: 2,
      expectedRevision: 0,
    },
  }).entry;
  const request = f.request(),
    prepared = await f.continuity.prepare(request);
  f.memory.forget(f.bot.botId, original.id, 1, attribution.author);
  const shown = await f.continuity.show(f.bot.botId, prepared.id);
  assert.deepEqual(shown.knowledge, []);
  assert.deepEqual(shown.captures, []);
  assert.equal(shown.suppressedReferenceCount, 2);
  assert.equal(JSON.stringify(shown).includes(original.id), false);
  assert.equal(JSON.stringify(shown).includes(derived.id), false);
  const calls = f.harness.inspection.sdk.calls.length;
  f.harness.sdk.stub("threads.get", () => {
    throw new Error("Source later unavailable");
  });
  assert.equal((await f.continuity.prepare(request)).replay, true);
  assert.equal(f.harness.inspection.sdk.calls.length, calls);
  await assert.rejects(
    f.continuity.prepare({ ...request, reason: "Changed request" }),
    /different options/,
  );
});

test("current closed commitments and changed records are current state, never restored as old work", async (t) => {
  const f = fixture(t),
    botId = f.bot.botId,
    note = f.note().entry;
  const obligation = f.commitments.add(
    botId,
    {
      requestId: randomUUID(),
      ownerConversationId: f.worker.conversationId,
      what: "Finish investigation",
      evidence: [],
      reference: { kind: "unlinked", status: "open" },
    },
    attribution,
  );
  const prepared = await f.continuity.prepare(f.request());
  f.commitments.close(botId, obligation.id, 1, attribution);
  f.memory.correct({
    botId,
    id: note.id,
    expectedRevision: 1,
    topic: "Updated",
    markdown: "New content",
    sources: ["artifact:new"],
    parents: [],
    basis: "fact",
    ...attribution,
  });
  const shown = await f.continuity.show(botId, prepared.id);
  assert.equal(shown.knowledge[0]?.state, "changed");
  assert.equal(shown.knowledge[0]?.selectedRevision, 1);
  assert.equal(shown.knowledge[0]?.currentRevision, 2);
  assert.equal(shown.currentCommitments[0]?.status, "closed");
  assert.equal(
    shown.currentCommitments[0]?.ownerConversationId,
    f.worker.conversationId,
  );
  assert.equal(f.commitments.get(botId, obligation.id).revision, 2);
  assert.equal(f.memory.show(botId, note.id).revision, 2);
  assert.equal(shown.currentTaskSource.availability, "unconfigured");
});

test("checkpoint and preparation references roll back together after an actual SQLite fault", async (t) => {
  const f = fixture(t),
    request = f.request(),
    db = f.bb.storage.database();
  db.exec(
    "CREATE TRIGGER fail_preparation BEFORE INSERT ON documents WHEN NEW.name GLOB 'CONTINUITY:*' BEGIN SELECT RAISE(ABORT,'fixture preparation failure'); END",
  );
  await assert.rejects(f.continuity.prepare(request), /preparation failure/);
  assert.deepEqual(f.checkpoints.list(f.bot.botId).items, []);
  assert.equal(
    f.store.documents.get(f.bot.botId, `CONTINUITY:${request.requestId}.json`),
    null,
  );
  db.exec("DROP TRIGGER fail_preparation");
  assert.equal((await f.continuity.prepare(request)).replay, false);
});

test("competing identical requests create one immutable checkpoint and one preparation", async (t) => {
  const f = fixture(t),
    request = f.request();
  const results = await Promise.all([
    f.continuity.prepare(request),
    f.continuity.prepare(request),
  ]);
  assert.equal(new Set(results.map((item) => item.id)).size, 1);
  assert.deepEqual(results.map((item) => item.replay).sort(), [false, true]);
  assert.equal(f.checkpoints.list(f.bot.botId).items.length, 1);
});

test("wrong bot, native source changes and cancellation refuse before committing preparation", async (t) => {
  const f = fixture(t),
    request = f.request();
  await assert.rejects(
    f.continuity.prepare({ ...request, botId: f.other.botId }),
    /same-bot/,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  f.harness.sdk.stub("threads.context", () => {
    f.bb.storage
      .database()
      .prepare("UPDATE conversations SET thread_id='thr_changed' WHERE id=?")
      .run(f.bot.conversationId);
    return { usage: null };
  });
  await assert.rejects(f.continuity.prepare(request), /conversation changed/);
  assert.deepEqual(f.checkpoints.list(f.bot.botId).items, []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.continuity.prepare(request, controller.signal));
  assert.deepEqual(f.checkpoints.list(f.bot.botId).items, []);
});
