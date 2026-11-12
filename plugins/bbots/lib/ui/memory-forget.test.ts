import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import plugin from "../../server.ts";
import { fixture as memoryFixture } from "../memory/fixture.test.ts";
import { memoryForgetContract } from "./memory-forget.ts";

function fixture(t: TestContext) {
  const f = memoryFixture(t);
  plugin(f.bb);
  f.setup.conversations.bindInitialThread(f.bot.conversationId, "thr_owned");
  f.setup.conversations.bindInitialThread(f.other.conversationId, "thr_other");
  const entry = f.memory.create(f.input()).entry;
  const request = {
    threadId: "thr_owned",
    expectedBotId: f.bot.botId,
    id: entry.id,
    expectedRevision: entry.revision,
    confirm: true as const,
  };
  return {
    ...f,
    entry,
    request,
    async forget(value = request, signal?: AbortSignal) {
      return memoryForgetContract.botMemoryForget.output.parse(
        await f.harness.behavior.callRpc("botMemoryForget", value, { signal }),
      );
    },
  };
}

test("native forgetting suppresses known sources and derivatives without retaining body text or changing historical revisions; replay adds no exclusions", async (t) => {
  const f = fixture(t);
  const derived = f.memory.create(
    f.input({
      sources: [],
      parents: [{ id: f.entry.id, revision: 1 }],
      markdown: "Derived observation",
    }),
  ).entry;
  const revisions = f.db
    .prepare("SELECT COUNT(*) AS count FROM document_revisions")
    .get();
  const result = await f.forget();
  assert.equal(result.availability, "suppressed");
  assert.equal(result.botId, f.bot.botId);
  assert.equal("record" in result, false);
  assert.equal(
    f.memory.show(f.bot.botId, derived.id).availability,
    "suppressed",
  );
  assert.equal(f.memory.search(f.bot.botId).items.length, 0);
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS count FROM document_revisions").get(),
    revisions,
  );
  const exclusions = f.db
    .prepare("SELECT * FROM memory_exclusions ORDER BY kind,key")
    .all();
  assert.ok(!JSON.stringify(exclusions).includes("Prefer concise evidence."));
  assert.ok(
    exclusions.every(
      (row) => (row as { author: string }).author === "user:bot-records",
    ),
  );
  assert.deepEqual(await f.forget(), result);
  assert.deepEqual(
    f.db.prepare("SELECT * FROM memory_exclusions ORDER BY kind,key").all(),
    exclusions,
  );
  const reloaded = await f.harness.lifecycle.reload(plugin);
  t.after(() => reloaded.harness.lifecycle.dispose());
  assert.equal(
    (
      (await reloaded.harness.behavior.callRpc("botMemory", {
        threadId: "thr_owned",
        id: f.entry.id,
      })) as { availability: string }
    ).availability,
    "suppressed",
  );
  assert.equal(reloaded.harness.inspection.sdk.calls.length, 0);
});

test("unknown or mismatched ownership, another bot's note, absent confirmation and cancellation refuse before exclusions", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.forget({ ...f.request, threadId: "thr_foreign" }),
    /not owned/,
  );
  await assert.rejects(
    f.forget({ ...f.request, expectedBotId: f.other.botId }),
    /ownership differs/,
  );
  await assert.rejects(
    f.forget({
      ...f.request,
      threadId: "thr_other",
      expectedBotId: f.other.botId,
    }),
    /not found/,
  );
  await assert.rejects(
    f.harness.behavior.callRpc("botMemoryForget", {
      ...f.request,
      confirm: false,
    }),
  );
  const controller = new AbortController();
  controller.abort(new Error("Canceled forgetting"));
  await assert.rejects(
    f.forget(f.request, controller.signal),
    /Canceled forgetting/,
  );
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS count FROM memory_exclusions").get(),
    { count: 0 },
  );
  assert.equal(
    f.memory.show(f.bot.botId, f.entry.id).availability,
    "available",
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("an intervening correction refuses stale forgetting without excluding its new content", async (t) => {
  const f = fixture(t);
  f.memory.correct({
    botId: f.bot.botId,
    id: f.entry.id,
    expectedRevision: 1,
    topic: "Revised",
    markdown: "Current evidence",
    basis: "fact",
    sources: ["user:corrected"],
    parents: [],
    author: "fixture-user",
    reason: "Later explicit correction",
  });
  await assert.rejects(f.forget(), /Memory changed/);
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS count FROM memory_exclusions").get(),
    { count: 0 },
  );
  const current = f.memory.show(f.bot.botId, f.entry.id);
  assert.equal(current.availability, "available");
  if (current.availability === "available")
    assert.equal(current.record.markdown, "Current evidence");
  assert.equal(
    (await f.forget({ ...f.request, expectedRevision: 2 })).availability,
    "suppressed",
  );
});
