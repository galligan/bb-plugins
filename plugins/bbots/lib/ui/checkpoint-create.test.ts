import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import plugin from "../../server.ts";
import { fixture as memoryFixture } from "../memory/fixture.test.ts";
import { checkpointUiContract } from "./checkpoint-contracts.ts";

function fixture(t: TestContext) {
  const f = memoryFixture(t);
  plugin(f.bb);
  f.setup.conversations.bindInitialThread(f.bot.conversationId, "thr_owned");
  f.setup.conversations.bindInitialThread(f.other.conversationId, "thr_other");
  const request = {
    threadId: "thr_owned",
    expectedBotId: f.bot.botId,
    requestId: randomUUID(),
    name: "Before edits",
    reason: "Explicit named checkpoint",
  };
  return {
    ...f,
    request,
    async create(value = request, signal?: AbortSignal) {
      return checkpointUiContract.botCheckpointCreate.output.parse(
        await f.harness.behavior.callRpc("botCheckpointCreate", value, {
          signal,
        }),
      );
    },
  };
}

test("the real native action creates an attributable local selection; replay retains it after edits with no SDK calls", async (t) => {
  const f = fixture(t);
  f.memory.create(f.input());
  const saved = await f.create();
  assert.equal(saved.checkpoint.botId, f.bot.botId);
  assert.equal(saved.checkpoint.author, "user:bot-records");
  assert.equal(saved.replay, false);
  const original = f.db
    .prepare("SELECT snapshot_json FROM checkpoints WHERE id=?")
    .get(saved.checkpoint.id);
  f.setup.profiles.rename({
    botId: f.bot.botId,
    expectedRevision: 1,
    name: "Renamed Bob",
    author: "fixture-user",
    reason: "Later edit",
  });
  const recovered = await f.create();
  assert.equal(recovered.replay, true);
  assert.deepEqual(recovered.checkpoint, saved.checkpoint);
  assert.deepEqual(
    f.db
      .prepare("SELECT snapshot_json FROM checkpoints WHERE id=?")
      .get(saved.checkpoint.id),
    original,
  );
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS count FROM checkpoints").get(),
    { count: 1 },
  );
  await assert.rejects(
    f.create({ ...f.request, name: "Different request options" }),
    /different options/,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("unknown, stale-bot and canceled native actions refuse before any checkpoint write", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    f.create({ ...f.request, threadId: "thr_foreign" }),
    /not owned/,
  );
  await assert.rejects(
    f.create({ ...f.request, threadId: "thr_other" }),
    /ownership differs/,
  );
  await assert.rejects(
    f.create({ ...f.request, expectedBotId: f.other.botId }),
    /ownership differs/,
  );
  const controller = new AbortController();
  controller.abort(new Error("Canceled creation"));
  await assert.rejects(
    f.create(f.request, controller.signal),
    /Canceled creation/,
  );
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS count FROM checkpoints").get(),
    { count: 0 },
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("the native adapter preserves checkpoint atomicity on entry failure and keeps forgotten knowledge excluded", async (t) => {
  const f = fixture(t);
  const entry = f.memory.create(f.input()).entry;
  f.db.exec(
    "CREATE TRIGGER fail_ui_checkpoint BEFORE INSERT ON checkpoint_entries BEGIN SELECT RAISE(ABORT,'fixture checkpoint failure'); END",
  );
  await assert.rejects(f.create(), /fixture checkpoint failure/);
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS count FROM checkpoints").get(),
    { count: 0 },
  );
  f.db.exec("DROP TRIGGER fail_ui_checkpoint");
  f.memory.forget(f.bot.botId, entry.id, entry.revision, "fixture-user");
  await f.create();
  assert.deepEqual(
    f.db
      .prepare(
        "SELECT COUNT(*) AS count FROM checkpoint_entries e JOIN documents d ON d.id=e.document_id WHERE d.name=?",
      )
      .get(`MEMORY:${entry.id.slice(4)}.json`),
    { count: 0 },
  );
});
