import { openStore } from "./store.ts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { change, isCode } from "./fixture.ts";
import Database from "better-sqlite3";
import { Documents } from "./documents.ts";

function fixture(t: TestContext) {
  const host = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => host.harness.lifecycle.dispose());
  return { ...host, store: openStore(host.bb.storage) };
}

test("document writes keep per-record revisions, original Markdown, provenance and bot isolation", (t) => {
  const { bb, store } = fixture(t);
  const a = store.profiles.create({ name: "Bob", ...change }).bot;
  const b = store.profiles.create({ name: "Bob", ...change }).bot;
  const first = store.documents.write({
    botId: a.id,
    name: "SOUL.md",
    markdown: "# Soul\n\nBe candid.\n",
    expectedRevision: 0,
    ...change,
  });
  const secondDb = new Database(bb.storage.database().name);
  t.after(() => secondDb.close());
  const second = new Documents(secondDb);
  assert.throws(
    () =>
      second.write({
        botId: a.id,
        name: "SOUL.md",
        markdown: "Stale creation",
        expectedRevision: 0,
        ...change,
      }),
    isCode("revision_conflict"),
  );
  const next = second.write({
    botId: a.id,
    name: "SOUL.md",
    markdown: "Be concise.",
    expectedRevision: 1,
    ...change,
  });
  assert.equal(next.id, first.id);
  assert.equal(next.revision, 2);
  assert.deepEqual(store.documents.revision(a.id, "SOUL.md", 1), first);
  assert.equal(store.documents.get(b.id, "SOUL.md"), null);
  const other = store.documents.write({
    botId: a.id,
    name: "notes.md",
    markdown: "Separate record",
    expectedRevision: 0,
    ...change,
  });
  assert.equal(other.revision, 1);
  assert.throws(
    () =>
      store.documents.write({
        botId: a.id,
        name: "SOUL.md",
        markdown: "Lost update",
        expectedRevision: 1,
        ...change,
      }),
    isCode("revision_conflict"),
  );
  assert.equal(store.documents.get(a.id, "SOUL.md")?.markdown, "Be concise.");
});

test("failed document and profile revision inserts roll back their current pointers", (t) => {
  const { bb, store } = fixture(t);
  const bot = store.profiles.create({ name: "Bob", ...change }).bot;
  const original = store.documents.write({
    botId: bot.id,
    name: "SOUL.md",
    markdown: "Original",
    expectedRevision: 0,
    ...change,
  });
  bb.storage
    .database()
    .exec(
      "CREATE TRIGGER fail_document BEFORE INSERT ON document_revisions BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
  assert.throws(() =>
    store.documents.write({
      botId: bot.id,
      name: "SOUL.md",
      markdown: "Not committed",
      expectedRevision: 1,
      ...change,
    }),
  );
  assert.deepEqual(store.documents.get(bot.id, "SOUL.md"), original);
  bb.storage
    .database()
    .exec(
      "CREATE TRIGGER fail_profile BEFORE INSERT ON bot_revisions BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
  assert.throws(() =>
    store.profiles.rename({
      botId: bot.id,
      expectedRevision: 1,
      name: "Not committed",
      ...change,
    }),
  );
  assert.deepEqual(store.profiles.get(bot.id), bot);
});

test("invalid and oversized input cannot create partial state", (t) => {
  const { bb, store } = fixture(t);
  assert.throws(() => store.profiles.create({ name: "  ", ...change }));
  const bot = store.profiles.create({ name: "Bob", ...change }).bot;
  assert.throws(() =>
    store.documents.write({
      botId: bot.id,
      name: "SOUL.md",
      markdown: "x".repeat(65_537),
      expectedRevision: 0,
      ...change,
    }),
  );
  assert.throws(
    () =>
      store.documents.write({
        botId: "missing",
        name: "SOUL.md",
        markdown: "No orphan",
        expectedRevision: 0,
        ...change,
      }),
    isCode("not_found"),
  );
  assert.throws(() =>
    store.profiles.rename({
      botId: bot.id,
      expectedRevision: 0,
      name: "Bad revision",
      ...change,
    }),
  );
  assert.equal(
    (
      bb.storage
        .database()
        .prepare("SELECT count(*) AS n FROM documents")
        .get() as { n: number }
    ).n,
    0,
  );
});
