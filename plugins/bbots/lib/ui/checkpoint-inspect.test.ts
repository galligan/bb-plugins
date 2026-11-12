import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import plugin from "../../server.ts";
import { fixture as memoryFixture } from "../memory/fixture.test.ts";
import { openSoul } from "../soul/store.ts";
import { openCheckpoints } from "../checkpoints/store.ts";
import { checkpointInspectContract } from "./checkpoint-inspect.ts";

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
    create(botId = f.bot.botId) {
      return checkpoints.create({
        botId,
        requestId: randomUUID(),
        name: "Before edits",
        author: "fixture",
        reason: "Explicit selection",
      }).checkpoint.id;
    },
    async inspect(
      id: string,
      options: {
        after?: string;
        threadId?: string;
        expectedBotId?: string;
      } = {},
      signal?: AbortSignal,
    ) {
      return checkpointInspectContract.botCheckpoint.output.parse(
        await f.harness.behavior.callRpc(
          "botCheckpoint",
          { threadId: "thr_owned", expectedBotId: f.bot.botId, id, ...options },
          { signal },
        ),
      );
    },
  };
}

test("checkpoint inspection keeps saved revisions/profile distinct from current state, one selected document per page, with no SDK or writes", async (t) => {
  const f = fixture(t);
  const entry = f.memory.create(
    f.input({
      sources: Array.from({ length: 25 }, (_, i) => `artifact:source${i}`),
    }),
  ).entry;
  const id = f.create();
  f.setup.profiles.rename({
    botId: f.bot.botId,
    expectedRevision: 1,
    name: "New Bob",
    author: "fixture",
    reason: "Later rename",
  });
  f.memory.correct({
    botId: f.bot.botId,
    id: entry.id,
    expectedRevision: 1,
    topic: "Later topic",
    markdown: "New body",
    basis: "fact",
    sources: ["artifact:new"],
    parents: [],
    author: "fixture",
    reason: "Later correction",
  });
  const before = f.db
    .prepare("SELECT COUNT(*) AS count FROM document_revisions")
    .get();
  let page = await f.inspect(id);
  assert.equal(page.name, "New Bob");
  assert.deepEqual(page.profile, { name: "Bob", revision: 1 });
  const documents = [];
  if (page.document) documents.push(page.document);
  while (page.nextCursor) {
    const after = page.nextCursor;
    page = await f.inspect(id, { after });
    assert.equal(page.after, after);
    if (page.document) documents.push(page.document);
  }
  const saved = documents.find((doc) => doc.kind === "knowledge")!;
  assert.equal(saved.revision, 1);
  assert.equal(saved.markdown, "Prefer concise evidence.");
  assert.equal(saved.sourceCount, 25);
  assert.equal(saved.sources.length, 20);
  assert.equal(documents.length, page.selectedDocuments);
  assert.equal(new Set(documents.map((doc) => doc.id)).size, documents.length);
  const worker = await f.inspect(id, { threadId: "thr_worker" });
  assert.equal(worker.botId, f.bot.botId);
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS count FROM document_revisions").get(),
    before,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  const reloaded = await f.harness.lifecycle.reload(plugin);
  t.after(() => reloaded.harness.lifecycle.dispose());
  const afterReload = await reloaded.harness.behavior.callRpc("botCheckpoint", {
    threadId: "thr_owned",
    expectedBotId: f.bot.botId,
    id,
  });
  assert.deepEqual(afterReload, { ...worker, threadId: "thr_owned" });
});

test("current exclusions filter historical selected bodies, and excluded cursors remain safe to continue", async (t) => {
  const f = fixture(t);
  const entry = f.memory.create(f.input()).entry;
  const id = f.create();
  let page = await f.inspect(id);
  while (page.document?.kind !== "knowledge" && page.nextCursor)
    page = await f.inspect(id, { after: page.nextCursor });
  assert.equal(page.document?.kind, "knowledge");
  const documentId = page.document!.id;
  f.memory.forget(f.bot.botId, entry.id, entry.revision, "fixture");
  const current = await f.inspect(id);
  assert.equal(
    JSON.stringify(current).includes("Prefer concise evidence"),
    false,
  );
  const rest = await f.inspect(id, { after: documentId });
  assert.equal(JSON.stringify(rest).includes("Prefer concise evidence"), false);
  assert.equal(rest.selectedDocuments, page.selectedDocuments);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("foreign checkpoints/cursors, changed ownership, unknown threads and canceled reads refuse", async (t) => {
  const f = fixture(t);
  f.memory.create(f.input());
  const id = f.create(),
    otherId = f.create(f.other.botId);
  await assert.rejects(f.inspect(otherId), /not found/);
  await assert.rejects(f.inspect(id, { threadId: "thr_unowned" }), /not owned/);
  await assert.rejects(
    f.inspect(id, { expectedBotId: f.other.botId }),
    /ownership changed/,
  );
  await assert.rejects(
    f.inspect(id, { threadId: "thr_other" }),
    /ownership changed/,
  );
  await assert.rejects(f.inspect(id, { after: "foreign-document" }), /cursor/);
  const controller = new AbortController();
  controller.abort(new Error("Canceled inspection"));
  await assert.rejects(
    f.inspect(id, {}, controller.signal),
    /Canceled inspection/,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});
