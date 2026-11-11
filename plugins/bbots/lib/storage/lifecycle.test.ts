import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { change } from "./fixture.ts";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openStore } from "./store.ts";

function fixture(t: TestContext) {
  const host = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => host.harness.lifecycle.dispose());
  return { ...host, store: openStore(host.bb.storage) };
}

test("migrations, identity, ownership and Markdown survive SDK reload and closed handles fail", async (t) => {
  const { bb, harness, store } = fixture(t);
  const { bot, mainConversationId } = store.profiles.create({
    name: "Bob",
    ...change,
  });
  const soul = store.documents.write({
    botId: bot.id,
    name: "SOUL.md",
    markdown: "Revision one",
    expectedRevision: 0,
    ...change,
  });
  store.conversations.bindInitialThread(mainConversationId, "thread-main");
  openStore(bb.storage);
  let reloaded = store;
  await harness.lifecycle.reload((next) => {
    reloaded = openStore(next.storage);
  });
  assert.throws(() => store.profiles.get(bot.id));
  assert.deepEqual(reloaded.profiles.get(bot.id), bot);
  assert.deepEqual(reloaded.documents.get(bot.id, "SOUL.md"), soul);
  assert.equal(
    reloaded.conversations.ownerOfThread("thread-main")?.id,
    mainConversationId,
  );
});

test("committed records survive closing SQLite and reopening in a separate Node process", (t) => {
  const { bb, store } = fixture(t);
  const { bot, mainConversationId } = store.profiles.create({
    name: "Bob",
    ...change,
  });
  store.documents.write({
    botId: bot.id,
    name: "SOUL.md",
    markdown: "Durable soul",
    expectedRevision: 0,
    ...change,
  });
  store.conversations.bindInitialThread(mainConversationId, "durable-thread");
  const db = bb.storage.database();
  const file = db.name;
  db.close();
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import Database from "better-sqlite3";
    import { Profiles } from "./profiles.ts";
    import { Documents } from "./documents.ts";
    import { Conversations } from "./conversations.ts";
    const db = new Database(process.argv[1]);
    const bot = new Profiles(db).get(process.argv[2]);
    const soul = new Documents(db).get(bot.id, "SOUL.md");
    const owner = new Conversations(db).ownerOfThread("durable-thread");
    console.log(JSON.stringify({bot, soul, owner}));
    db.close();
  `,
      file,
      bot.id,
    ],
    {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const restored = JSON.parse(result.stdout);
  assert.deepEqual(restored.bot, bot);
  assert.equal(restored.soul.markdown, "Durable soul");
  assert.equal(restored.owner.id, mainConversationId);
  assert.equal(restored.owner.botId, bot.id);
});
