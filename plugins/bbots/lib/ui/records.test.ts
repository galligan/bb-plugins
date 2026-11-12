import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import plugin from "../../server.ts";
import { fixture as memoryFixture } from "../memory/fixture.test.ts";
import { openSoul } from "../soul/store.ts";
import { openCheckpoints } from "../checkpoints/store.ts";
import { recordsContract } from "./records-contracts.ts";

function fixture(t: TestContext) {
  const f = memoryFixture(t);
  plugin(f.bb);
  f.setup.conversations.bindInitialThread(f.bot.conversationId, "thr_owned");
  f.setup.conversations.bindInitialThread(f.other.conversationId, "thr_other");
  f.db
    .prepare("INSERT INTO conversations VALUES (?, ?, 'worker', ?, ?)")
    .run("conv_worker", f.bot.botId, "thr_worker", new Date().toISOString());
  const checkpoints = openCheckpoints(
    f.bb.storage,
    f.setup,
    openSoul(f.bb.storage, f.setup, () => {}),
  );
  return {
    ...f,
    checkpoints,
    async index(input = {}) {
      return recordsContract.botRecords.output.parse(
        await f.harness.behavior.callRpc("botRecords", {
          threadId: "thr_owned",
          ...input,
        }),
      );
    },
    async note(id: string, threadId = "thr_owned") {
      return recordsContract.botMemory.output.parse(
        await f.harness.behavior.callRpc("botMemory", { threadId, id }),
      );
    },
    checkpoint(name = "Before edits", botId = f.bot.botId) {
      return checkpoints.create({
        botId,
        requestId: randomUUID(),
        name,
        author: "fixture",
        reason: "Explicit checkpoint",
      });
    },
  };
}

test("native records derive the bot from SQLite ownership for both main and worker, with no SDK calls or record writes", async (t) => {
  const f = fixture(t),
    entry = f.memory.create(f.input()).entry;
  f.checkpoint();
  const before = f.db
    .prepare("SELECT COUNT(*) AS count FROM document_revisions")
    .get();
  const page = await f.index();
  assert.equal(page.botId, f.bot.botId);
  assert.equal(page.memory.items[0]?.id, entry.id);
  assert.equal(page.checkpoints.items[0]?.name, "Before edits");
  const worker = await f.index({ threadId: "thr_worker" });
  assert.deepEqual(worker.memory, page.memory);
  assert.equal(worker.threadId, "thr_worker");
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS count FROM document_revisions").get(),
    before,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  const reloaded = await f.harness.lifecycle.reload(plugin);
  t.after(() => reloaded.harness.lifecycle.dispose());
  const after = recordsContract.botRecords.output.parse(
    await reloaded.harness.behavior.callRpc("botRecords", {
      threadId: "thr_owned",
    }),
  );
  assert.deepEqual(after, page);
  assert.equal(reloaded.harness.inspection.sdk.calls.length, 0);
});

test("foreign/unowned thread, memory and cursor selectors cannot cross bot boundaries", async (t) => {
  const f = fixture(t),
    other = f.memory.create(
      f.input({ botId: f.other.botId, topic: "Private other bot" }),
    ).entry;
  const checkpoint = f.checkpoint("Other checkpoint", f.other.botId);
  assert.equal((await f.index()).memory.items.length, 0);
  assert.equal((await f.index()).checkpoints.items.length, 0);
  await assert.rejects(f.index({ threadId: "thr_unowned" }), /not owned/);
  await assert.rejects(f.note(other.id), /not found/);
  await assert.rejects(f.index({ memoryAfter: other.id }), /cursor/);
  await assert.rejects(
    f.index({ checkpointAfter: checkpoint.checkpoint.id }),
    /not found/,
  );
  assert.equal((await f.note(other.id, "thr_other")).availability, "available");
  await assert.rejects(
    f.harness.behavior.callRpc("botRecords", {
      threadId: "thr_owned",
      botId: f.other.botId,
    }),
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("indices are bounded literal searches with separate memory/checkpoint cursors and exact evidence counts", async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 12; i++) {
    f.memory.create(
      f.input({
        topic: `Topic ${i}`,
        markdown: i === 0 ? "literal %_ value" : `Body ${i}`,
      }),
    );
    f.checkpoint(`Checkpoint ${i}`);
  }
  const first = await f.index();
  assert.equal(first.memory.items.length, 10);
  assert.equal(first.checkpoints.items.length, 10);
  assert.ok(first.memory.nextCursor);
  assert.ok(first.checkpoints.nextCursor);
  const next = await f.index({
    memoryAfter: first.memory.nextCursor,
    checkpointAfter: first.checkpoints.nextCursor,
  });
  assert.equal(next.memory.items.length, 2);
  assert.equal(next.checkpoints.items.length, 2);
  assert.equal(next.memory.nextCursor, null);
  assert.equal(next.checkpoints.nextCursor, null);
  assert.equal(
    new Set(
      [...first.memory.items, ...next.memory.items].map((item) => item.id),
    ).size,
    12,
  );
  assert.equal((await f.index({ query: "%_" })).memory.items.length, 1);
  assert.equal((await f.index({ query: "missing" })).memory.items.length, 0);
  const id = f.memory.create(
    f.input({
      topic: "Many sources",
      sources: Array.from({ length: 25 }, (_, i) => `artifact:source${i}`),
    }),
  ).entry.id;
  const detail = await f.note(id);
  assert.equal(detail.availability, "available");
  if (detail.availability === "available") {
    assert.equal(detail.note.sourceCount, 25);
    assert.equal(detail.note.sources.length, 20);
    assert.equal(detail.note.markdown, "Prefer concise evidence.");
  }
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("forgetting removes new index/detail content while retaining historical checkpoint headers and structured capture evidence", async (t) => {
  const f = fixture(t),
    entry = f.memory.create(f.input()).entry;
  f.checkpoint();
  f.memory.forget(f.bot.botId, entry.id, 1, "user");
  assert.equal((await f.index()).memory.items.length, 0);
  const suppressed = await f.note(entry.id);
  assert.equal(suppressed.availability, "suppressed");
  assert.equal(
    JSON.stringify(suppressed).includes("Prefer concise evidence"),
    false,
  );
  assert.equal((await f.index()).checkpoints.items.length, 1);
  f.memory.create(
    f.input({
      kind: "state",
      topic: "Worker state",
      sources: ["thread:thr_worker#msg=1"],
      boundary: {
        streamId: "thread:thr_worker",
        from: 1,
        through: 3,
        expectedRevision: 0,
      },
    }),
  );
  const captures = await f.index({ kind: "state" });
  assert.equal(captures.memory.items[0]?.kind, "state");
  assert.ok(
    captures.memory.items[0]?.sources.some((source) => source.includes("1–3")),
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});
