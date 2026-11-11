import { openStore } from "./store.ts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { change, isCode } from "./fixture.ts";
import Database from "better-sqlite3";
import { Profiles } from "./profiles.ts";

function fixture(t: TestContext) {
  const host = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => host.harness.lifecycle.dispose());
  return { ...host, store: openStore(host.bb.storage) };
}

test("creation atomically records identity, revision and a stable unbound main before any provider call", async (t) => {
  const { bb, store, harness } = fixture(t);
  const { bot, mainConversationId } = store.profiles.create({
    name: " Bob ",
    ...change,
  });
  assert.equal(bot.name, "Bob");
  assert.equal(bot.revision, 1);
  assert.equal(store.profiles.revision(bot.id, 1).author, change.author);
  const main = store.conversations.get(mainConversationId);
  assert.equal(main.botId, bot.id);
  assert.equal(main.role, "main");
  assert.equal(main.threadId, null);
  assert.equal(harness.inspection.sdk.calls.length, 0);
  const db = bb.storage.database();
  db.exec(
    "CREATE TRIGGER fail_main BEFORE INSERT ON conversations BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
  );
  assert.throws(() => store.profiles.create({ name: "Second", ...change }));
  assert.equal(
    (db.prepare("SELECT count(*) AS n FROM bots").get() as { n: number }).n,
    1,
  );
  assert.equal(
    (
      db.prepare("SELECT count(*) AS n FROM bot_revisions").get() as {
        n: number;
      }
    ).n,
    1,
  );
});

test("stale profile edits from independent connections cannot overwrite a winner or its audit history", (t) => {
  const { bb, store } = fixture(t);
  const { bot, mainConversationId } = store.profiles.create({
    name: "Bob",
    ...change,
  });
  const secondDb = new Database(bb.storage.database().name);
  t.after(() => secondDb.close());
  const second = new Profiles(secondDb);
  const base = second.get(bot.id);
  const updated = store.profiles.rename({
    botId: bot.id,
    expectedRevision: 1,
    name: "Robert",
    ...change,
  });
  assert.throws(
    () =>
      second.rename({
        botId: bot.id,
        expectedRevision: base.revision,
        name: "Stale",
        ...change,
      }),
    isCode("revision_conflict"),
  );
  assert.equal(second.get(bot.id).name, "Robert");
  assert.equal(updated.id, bot.id);
  assert.equal(updated.revision, 2);
  assert.equal(store.profiles.revision(bot.id, 1).name, "Bob");
  assert.equal(store.profiles.revision(bot.id, 2).name, "Robert");
  assert.equal(store.conversations.get(mainConversationId).botId, bot.id);
  assert.throws(() => store.profiles.revision(bot.id, 3), isCode("not_found"));
});
