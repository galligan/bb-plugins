import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture } from "../commitments/fixtures.test.ts";
import { commitmentUiContract } from "./commitment-contracts.ts";

type Fixture = ReturnType<typeof fixture>;
async function index(f: Fixture, threadId = "thr_main", after?: string) {
  return commitmentUiContract.botCommitments.output.parse(
    await f.harness.behavior.callRpc("botCommitments", {
      threadId,
      ...(after ? { after } : {}),
    }),
  );
}
async function inspect(
  f: Fixture,
  id: string,
  threadId = "thr_main",
  signal?: AbortSignal,
) {
  return commitmentUiContract.botCommitment.output.parse(
    await f.harness.behavior.callRpc(
      "botCommitment",
      { threadId, id },
      { signal },
    ),
  );
}
function source(f: Fixture, boardId: string) {
  f.store.documents.write({
    botId: f.setup.botId,
    name: "TASKS.json",
    expectedRevision: 1,
    markdown: JSON.stringify({ kind: "tasks", phase: "ready", boardId }),
    author: "user",
    reason: "Changed authority",
  });
}

test("commitment pages use local ownership only, bound ten records and never fan out task status reads", async (t) => {
  const f = fixture(t);
  const manual = await f.add();
  for (let i = 0; i < 11; i++)
    assert.equal(
      (await f.add(["--task", "task_one"], randomUUID(), `Obligation ${i}`))
        .result.exitCode,
      0,
    );
  assert.equal((await f.close(manual.id, 1)).exitCode, 0);
  const before = f.harness.inspection.sdk.calls.length;
  const page = await index(f);
  assert.equal(page.records.length, 10);
  assert.ok(page.nextCursor);
  assert.ok(
    page.records.every(
      (row) => row.localStatus === null && row.owner.threadId === "thr_worker",
    ),
  );
  const next = await index(f, "thr_worker", page.nextCursor!);
  assert.equal(next.records.length, 2);
  assert.equal(next.nextCursor, null);
  assert.equal(
    next.records.find((row) => row.id === manual.id)?.localStatus,
    "closed",
  );
  assert.equal(
    new Set([...page.records, ...next.records].map((row) => row.id)).size,
    12,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, before);
  await f.reload();
  assert.deepEqual((await index(f)).records, page.records);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("an explicit linked detail reads authoritative task status without persisting a copied result", async (t) => {
  const f = fixture(t),
    added = await f.add(["--task", "task_one"]);
  const before = f.store.documents.get(
    f.setup.botId,
    `COMMITMENT:${added.id.slice(4)}.json`,
  );
  f.tasks.get("task_one")!.status = "done";
  const calls = f.harness.inspection.sdk.callsTo("plugins.callRpc").length;
  const detail = await inspect(f, added.id);
  assert.equal(detail.availability, "available");
  assert.equal(detail.status, "done");
  assert.equal(detail.authority, "tasks");
  assert.deepEqual(detail.task, { key: "OWN-1", title: "Source task" });
  assert.equal(
    f.harness.inspection.sdk.callsTo("plugins.callRpc").length,
    calls + 1,
  );
  assert.deepEqual(
    f.store.documents.get(
      f.setup.botId,
      `COMMITMENT:${added.id.slice(4)}.json`,
    ),
    before,
  );
  assert.equal((await index(f)).records[0]?.localStatus, null);
});

test("source changes during a selected read return unknown and require reconciliation rather than reporting old completion", async (t) => {
  const f = fixture(t),
    added = await f.add(["--task", "task_one"]);
  f.tasks.get("task_one")!.status = "done";
  const gate = f.pauseTaskRead(),
    pending = inspect(f, added.id);
  await gate.started;
  source(f, "tracker_new");
  gate.release();
  const late = await pending;
  assert.equal(late.availability, "changed-during-read");
  assert.equal(late.status, null);
  const before = f.harness.inspection.sdk.calls.length;
  const next = await inspect(f, added.id);
  assert.equal(next.availability, "source-reconciliation-required");
  assert.equal(next.status, null);
  assert.equal(f.harness.inspection.sdk.calls.length, before);
});

test("Markdown inspection retains the original home-host target with no machine-derived task status or host reads", async (t) => {
  const f = fixture(t);
  f.store.documents.write({
    botId: f.setup.botId,
    name: "TASKS.json",
    expectedRevision: 1,
    markdown: JSON.stringify({
      kind: "markdown",
      phase: "ready",
      hostId: "host_home",
      homePath: "/home/bob",
      path: "/home/bob/tasks.md",
      requestId: randomUUID(),
    }),
    author: "user",
    reason: "Existing file source",
  });
  const added = await f.add(["--markdown-reference", "Evidence section"]);
  const before = f.harness.inspection.sdk.calls.length;
  const detail = await inspect(f, added.id);
  assert.equal(detail.availability, "manual-source-read");
  assert.equal(detail.status, null);
  assert.equal(detail.reference.kind, "markdown");
  if (detail.reference.kind === "markdown") {
    assert.equal(detail.reference.hostId, "host_home");
    assert.equal(detail.reference.path, "/home/bob/tasks.md");
  }
  assert.equal(f.harness.inspection.sdk.calls.length, before);
});

test("unowned and cross-bot detail/cursor selectors refuse before source lookup", async (t) => {
  const f = fixture(t),
    added = await f.add(["--task", "task_one"]);
  const other = f.store.plan({
    requestId: randomUUID(),
    name: "Alice",
    hostId: "host_home",
    associations: { mode: "none" },
  });
  f.store.conversations.bindInitialThread(other.conversationId, "thr_other");
  const before = f.harness.inspection.sdk.calls.length;
  await assert.rejects(index(f, "thr_foreign"), /not owned/);
  await assert.rejects(inspect(f, added.id, "thr_foreign"), /not owned/);
  await assert.rejects(inspect(f, added.id, "thr_other"), /not found/);
  await assert.rejects(index(f, "thr_other", added.id), /cursor/);
  assert.equal(f.harness.inspection.sdk.calls.length, before);
});

test("cancellation of a selected source read refuses its late response with no retry or record change", async (t) => {
  const f = fixture(t),
    added = await f.add(["--task", "task_one"]);
  const gate = f.pauseTaskRead(),
    controller = new AbortController();
  const before = f.harness.inspection.sdk.callsTo("plugins.callRpc").length;
  const pending = inspect(f, added.id, "thr_main", controller.signal);
  await gate.started;
  controller.abort(new Error("Canceled inspection"));
  gate.release();
  await assert.rejects(pending, /Canceled inspection/);
  assert.equal(
    f.harness.inspection.sdk.callsTo("plugins.callRpc").length,
    before + 1,
  );
  assert.equal((await index(f)).records[0]?.revision, 1);
});

test("missing, wrong-board and unavailable task replies never fall back to manual or cached status", async (t) => {
  const f = fixture(t),
    added = await f.add(["--task", "task_one"]);
  const original = f.tasks.get("task_one")!;
  f.tasks.delete("task_one");
  assert.equal((await inspect(f, added.id)).availability, "missing");
  f.tasks.set("task_one", {
    ...original,
    projectId: "tracker_other",
    status: "done",
  });
  const wrong = await inspect(f, added.id);
  assert.equal(wrong.availability, "wrong-source");
  assert.equal(wrong.status, null);
  f.offline();
  const offline = await inspect(f, added.id);
  assert.equal(offline.availability, "unavailable");
  assert.equal(offline.status, null);
  assert.equal((await index(f)).records[0]?.localStatus, null);
});
