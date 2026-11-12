import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";
import { openWork } from "./storage.ts";
import { workerOverviewContract } from "./overview.ts";
import type { Destination } from "./contracts.ts";

function fixture(t: TestContext) {
  let host = createFakePluginHost({ pluginId: "bbots" });
  plugin(host.bb);
  let store = openSetup(host.bb.storage),
    work = openWork(host.bb.storage, store);
  const bot = store.plan({
    requestId: randomUUID(),
    hostId: "host_original",
    name: "Bob",
    associations: { mode: "none" },
  });
  store.conversations.bindInitialThread(bot.conversationId, "thr_main");
  t.after(() => host.harness.lifecycle.dispose());
  return {
    bot,
    get store() {
      return store;
    },
    get work() {
      return work;
    },
    get harness() {
      return host.harness;
    },
    plan(
      title = "Investigate",
      botId = bot.botId,
      reportTo: Destination = {
        kind: "conversation",
        conversationId: bot.conversationId,
      },
    ) {
      return work.plan({
        requestId: randomUUID(),
        botId,
        title,
        projectId: "proj_work",
        environmentId: "env_work",
        parentThreadId: "thr_parent",
        parentNotifications: "off",
        agreement: {
          assignment: "Private assignment body",
          context: "Private context",
          sources: ["private:source"],
          reportTo,
          reportWhen: "Done",
          reportContent: "Evidence",
          stopWhen: "User Stop",
        },
        author: "fixture",
        reason: "Existing owned worker",
      });
    },
    async read(offset = 0, botId = bot.botId) {
      return workerOverviewContract.workerOverview.output.parse(
        await host.harness.behavior.callRpc("workerOverview", {
          botId,
          offset,
        }),
      );
    },
    async reload() {
      host = await host.harness.lifecycle.reload(plugin);
      store = openSetup(host.bb.storage);
      work = openWork(host.bb.storage, store);
    },
  };
}

test("the worker overview reads only durable ownership, keeps parent/reporting distinct and survives reload with no SDK requests", async (t) => {
  const f = fixture(t),
    planned = f.plan();
  f.work.start(planned.conversationId);
  f.work.bind(planned.conversationId, "thr_worker");
  const first = await f.read();
  assert.deepEqual(first.workers[0], {
    conversationId: planned.conversationId,
    title: "Investigate",
    threadId: "thr_worker",
    phase: "bound",
    error: null,
    requestedParentThreadId: "thr_parent",
    report: {
      kind: "conversation",
      threadId: "thr_main",
      isOwnMain: true,
      revision: 1,
    },
  });
  const serialized = JSON.stringify(first);
  for (const text of [
    "Private assignment",
    "Private context",
    "private:source",
    "env_work",
    "requestId",
  ])
    assert.equal(serialized.includes(text), false);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  await f.reload();
  assert.deepEqual(await f.read(), first);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("empty, unbound and uncertain setup are separate from execution or completion, without a fabricated thread target", async (t) => {
  const f = fixture(t);
  assert.deepEqual((await f.read()).workers, []);
  const planned = f.plan();
  let row = (await f.read()).workers[0]!;
  assert.equal(row.phase, "planned");
  assert.equal(row.threadId, null);
  f.work.start(planned.conversationId);
  f.work.fail(planned.conversationId, "Unknown creation delivery");
  row = (await f.read()).workers[0]!;
  assert.equal(row.phase, "spawning");
  assert.equal(row.threadId, null);
  assert.equal(row.error, "Unknown creation delivery");
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("only the selected bot's first100 workers are paged ten at a time with no duplicates or false complete result", async (t) => {
  const f = fixture(t);
  const other = f.store.plan({
    requestId: randomUUID(),
    hostId: "host_other",
    name: "Alice",
    associations: { mode: "none" },
  });
  f.plan("Foreign worker", other.botId);
  for (let i = 0; i < 101; i++) f.plan(`Worker ${i}`);
  const seen = new Set<string>();
  for (let offset = 0; offset < 100; offset += 10) {
    const page = await f.read(offset);
    assert.equal(page.offset, offset);
    assert.equal(page.workers.length, 10);
    assert.equal(page.hasMoreBeyondLimit, true);
    assert.equal(page.nextOffset, offset === 90 ? null : offset + 10);
    for (const worker of page.workers) {
      assert.equal(seen.has(worker.conversationId), false);
      assert.notEqual(worker.title, "Foreign worker");
      seen.add(worker.conversationId);
    }
  }
  assert.equal(seen.size, 100);
  assert.equal(
    (await f.read(0, other.botId)).workers[0]?.title,
    "Foreign worker",
  );
  for (const offset of [-1, 5, 100]) await assert.rejects(f.read(offset));
  await assert.rejects(f.read(0, "bot_missing"));
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("current reporting-contract revisions resolve logical destinations while physical targets remain explicit", async (t) => {
  const f = fixture(t),
    worker = f.plan();
  const other = f.plan("Other owned worker");
  f.work.updateAgreement({
    conversationId: worker.conversationId,
    expectedRevision: 1,
    agreement: {
      ...worker.request.agreement,
      reportTo: { kind: "conversation", conversationId: other.conversationId },
    },
    author: "user",
    reason: "Changed report target",
  });
  let row = (await f.read()).workers.find(
    (value) => value.conversationId === worker.conversationId,
  )!;
  assert.deepEqual(row.report, {
    kind: "conversation",
    threadId: null,
    isOwnMain: false,
    revision: 2,
  });
  f.work.start(other.conversationId);
  f.work.bind(other.conversationId, "thr_later_bound");
  row = (await f.read()).workers.find(
    (value) => value.conversationId === worker.conversationId,
  )!;
  assert.equal(row.report.threadId, "thr_later_bound");
  f.work.updateAgreement({
    conversationId: worker.conversationId,
    expectedRevision: 2,
    agreement: {
      ...worker.request.agreement,
      reportTo: { kind: "thread", threadId: "thr_explicit" },
    },
    author: "user",
    reason: "Explicit physical target",
  });
  row = (await f.read()).workers.find(
    (value) => value.conversationId === worker.conversationId,
  )!;
  assert.deepEqual(row.report, {
    kind: "thread",
    threadId: "thr_explicit",
    isOwnMain: false,
    revision: 3,
  });
  assert.equal(row.requestedParentThreadId, "thr_parent");
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});
