import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openSetup } from "../setup/storage.ts";
import { openWork } from "./storage.ts";
import { workSchema } from "./contracts.ts";

function fixture(t: TestContext) {
  const host = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => host.harness.lifecycle.dispose());
  const store = openSetup(host.bb.storage);
  const setup = store.plan({
    requestId: randomUUID(),
    name: "Bob",
    hostId: "host_home",
    associations: { mode: "none" },
  });
  const work = openWork(host.bb.storage, store);
  const input = workSchema.parse({
    requestId: randomUUID(),
    botId: setup.botId,
    title: "Investigate",
    projectId: "project_other",
    environmentId: "env_other",
    author: "fixture-user",
    reason: "Explicit investigation",
    agreement: {
      assignment: "Find the cause and report evidence.",
      reportTo: { kind: "thread", threadId: "thr_monitor" },
    },
  });
  return { ...host, store, work, input, setup };
}

test("worker intent, independent identity and attributable contract commit before native work", (t) => {
  const { work, input, store, harness, setup } = fixture(t);
  const worker = work.plan(input);
  const owner = store.conversations.get(worker.conversationId);
  assert.equal(owner.role, "worker");
  assert.equal(owner.botId, setup.botId);
  assert.equal(owner.threadId, null);
  assert.notEqual(owner.id, setup.conversationId);
  assert.equal(worker.request.parentThreadId, undefined);
  assert.equal(worker.request.parentNotifications, "off");
  const contract = work.agreement(owner.id);
  assert.equal(contract.author, input.author);
  assert.equal(contract.revision, 1);
  assert.deepEqual(contract.agreement.reportTo, {
    kind: "thread",
    threadId: "thr_monitor",
  });
  assert.equal(harness.inspection.sdk.calls.length, 0);
  assert.throws(
    () => work.agreement(setup.conversationId),
    /no reporting contract/,
  );
});

test("request replay recovers the same logical worker but changed options cannot create or overwrite it", (t) => {
  const { work, input, bb } = fixture(t);
  const worker = work.plan(input);
  assert.deepEqual(work.plan(input), worker);
  assert.throws(
    () => work.plan({ ...input, parentThreadId: "thr_parent" }),
    /different options/,
  );
  const reopened = openWork(bb.storage, openSetup(bb.storage));
  assert.deepEqual(reopened.findRequest(input.requestId), worker);
  assert.deepEqual(
    reopened.agreement(worker.conversationId),
    work.agreement(worker.conversationId),
  );
});

test("partial intent is rolled back if saving the contract fails", (t) => {
  const { bb, work, input } = fixture(t);
  const db = bb.storage.database();
  db.exec(
    "CREATE TRIGGER reject_contract BEFORE INSERT ON documents WHEN NEW.name LIKE 'contract:%' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  assert.throws(() => work.plan(input), /fixture failure/);
  assert.equal(work.findRequest(input.requestId), null);
  assert.deepEqual(
    db.prepare("SELECT id FROM conversations WHERE role='worker'").all(),
    [],
  );
});

test("one native creation attempt and exclusive binding survive an uncertain receipt without replacement", (t) => {
  const { work, input, store } = fixture(t);
  const worker = work.plan(input);
  assert.throws(
    () => work.bind(worker.conversationId, "thr_worker"),
    /no active creation intent/,
  );
  work.start(worker.conversationId);
  work.fail(worker.conversationId, "Lost native receipt");
  assert.throws(
    () => work.start(worker.conversationId),
    /already been attempted/,
  );
  assert.equal(work.plan(input).phase, "spawning");
  work.bind(worker.conversationId, "thr_worker");
  assert.equal(work.get(worker.conversationId).error, null);
  assert.equal(work.get(worker.conversationId).phase, "bound");
  assert.equal(
    work.bind(worker.conversationId, "thr_worker").threadId,
    "thr_worker",
  );
  assert.throws(
    () => work.bind(worker.conversationId, "thr_duplicate"),
    /replacement needs a verified continuity/,
  );
  const second = work.plan({ ...input, requestId: randomUUID() });
  work.start(second.conversationId);
  assert.throws(
    () => work.bind(second.conversationId, "thr_worker"),
    /another logical conversation/,
  );
  assert.equal(work.get(second.conversationId).phase, "spawning");
  assert.equal(store.conversations.get(second.conversationId).threadId, null);
});

test("contract reassignment is revision checked and never rewrites its initial request or native parentage", (t) => {
  const { work, input, store } = fixture(t);
  const worker = work.plan({ ...input, parentThreadId: "thr_parent" });
  const original = work.agreement(worker.conversationId);
  const updated = work.updateAgreement({
    conversationId: worker.conversationId,
    expectedRevision: 1,
    author: "fixture-owner",
    reason: "Explicit reassignment",
    agreement: {
      ...original.agreement,
      assignment: "Revised assignment",
      reportTo: { kind: "conversation", conversationId: "conv_monitor" },
    },
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.author, "fixture-owner");
  assert.throws(
    () =>
      work.updateAgreement({
        conversationId: worker.conversationId,
        expectedRevision: 1,
        author: "stale",
        reason: "Stale edit",
        agreement: original.agreement,
      }),
    /Document changed/,
  );
  assert.deepEqual(work.agreement(worker.conversationId), updated);
  assert.equal(
    work.get(worker.conversationId).request.parentThreadId,
    "thr_parent",
  );
  assert.equal(
    work.get(worker.conversationId).request.agreement.assignment,
    input.agreement.assignment,
  );
  assert.equal(
    store.documents.revision(
      input.botId,
      `contract:${worker.conversationId}`,
      1,
    ).author,
    input.author,
  );
});
