import { openStore } from "./store.ts";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { change, isCode } from "./fixture.ts";
import Database from "better-sqlite3";
import { Conversations } from "./conversations.ts";

function fixture(t: TestContext) {
  const host = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => host.harness.lifecycle.dispose());
  return { ...host, store: openStore(host.bb.storage) };
}

test("initial thread binding is idempotent, exclusive and refuses unverified replacement", (t) => {
  const { bb, store } = fixture(t);
  const a = store.profiles.create({ name: "Bob", ...change });
  const b = store.profiles.create({ name: "Other", ...change });
  assert.equal(store.conversations.ownerOfThread("native-unowned"), null);
  const first = store.conversations.bindInitialThread(
    a.mainConversationId,
    "thread-a",
  );
  assert.deepEqual(
    store.conversations.bindInitialThread(a.mainConversationId, "thread-a"),
    first,
  );
  const secondDb = new Database(bb.storage.database().name);
  t.after(() => secondDb.close());
  const second = new Conversations(secondDb);
  assert.throws(
    () => second.bindInitialThread(a.mainConversationId, "thread-b"),
    isCode("already_bound"),
  );
  assert.throws(
    () => second.bindInitialThread(b.mainConversationId, "thread-a"),
    isCode("thread_owned"),
  );
  assert.throws(
    () => second.bindInitialThread("invented-conversation", "thread-c"),
    isCode("not_found"),
  );
  assert.equal(store.conversations.get(b.mainConversationId).threadId, null);
  assert.equal(
    store.conversations.ownerOfThread("thread-a")?.id,
    a.mainConversationId,
  );
});
