import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture } from "./fixtures.test.ts";

test("identical linked creation requests recover their original authority after migration, while changed submitted links still refuse", async (t) => {
  const f = fixture(t);
  const added = await f.add(["--task", "task_one"]);
  for (const [index, source] of [
    { kind: "tasks", phase: "ready", boardId: "tracker_new" },
    {
      kind: "markdown",
      phase: "ready",
      hostId: "host_home",
      homePath: "/home/bob",
      path: "/home/bob/tasks.md",
      requestId: randomUUID(),
    },
    {
      kind: "tasks",
      phase: "creating",
      name: "Uncertain migration fixture",
      prefix: "NEW",
    },
  ].entries()) {
    f.store.documents.write({
      botId: f.setup.botId,
      name: "TASKS.json",
      expectedRevision: index + 1,
      markdown: JSON.stringify(source),
      author: "fixture-user",
      reason: "Changed authority fixture",
    });
    const replay = await f.run(added.args);
    assert.equal(replay.exitCode, 0, replay.stderr);
    const found = JSON.parse(replay.stdout);
    assert.equal(found.record.reference.boardId, "tracker_owned");
    assert.equal(found.status, null);
    assert.equal(found.availability, "source-reconciliation-required");
    assert.equal(found.revision, 1);
    const changed = await f.run(
      added.args.map((arg) => (arg === "task_one" ? "task_two" : arg)),
    );
    assert.equal(changed.exitCode, 1);
  }
});

test("Markdown request replay recovers the original file reference after switching to a Tasks board", async (t) => {
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
    author: "fixture-user",
    reason: "Markdown authority fixture",
  });
  const added = await f.add(["--markdown-reference", "Original obligation"]);
  assert.equal(added.result.exitCode, 0, added.result.stderr);
  f.store.documents.write({
    botId: f.setup.botId,
    name: "TASKS.json",
    expectedRevision: 2,
    markdown: JSON.stringify({
      kind: "tasks",
      phase: "ready",
      boardId: "tracker_new",
    }),
    author: "fixture-user",
    reason: "New Tasks authority fixture",
  });
  const replay = await f.run(added.args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(
    JSON.parse(replay.stdout).record.reference.path,
    "/home/bob/tasks.md",
  );
  assert.equal(
    JSON.parse(replay.stdout).availability,
    "source-reconciliation-required",
  );
  const changed = await f.run(
    added.args.map((arg) =>
      arg === "Original obligation" ? "Another obligation" : arg,
    ),
  );
  assert.equal(changed.exitCode, 1);
});

test("cancellation during a status read retains the committed obligation and same-request recovery creates no duplicate", async (t) => {
  const f = fixture(t);
  const controller = new AbortController();
  const requestId = randomUUID();
  const args = [
    "commitment",
    "add",
    f.setup.botId,
    "--task",
    "task_one",
    "--what",
    "Retain the obligation",
    "--request-id",
    requestId,
    "--author",
    "fixture-user",
    "--reason",
    "Explicit obligation",
    "--json",
  ];
  const pause = f.pauseTaskRead();
  t.after(pause.release);
  const pending = f.run(args, {
    threadId: "thr_worker",
    signal: controller.signal,
  });
  await pause.started;
  assert.ok(
    f.store.documents.get(f.setup.botId, `COMMITMENT:${requestId}.json`),
  );
  controller.abort(new Error("User canceled the read"));
  pause.release();
  assert.equal((await pending).exitCode, 1);
  const recovered = await f.run(args);
  assert.equal(recovered.exitCode, 0, recovered.stderr);
  assert.equal(JSON.parse(recovered.stdout).revision, 1);
  const listed = await f.run(["commitment", "list", f.setup.botId, "--json"]);
  assert.equal(JSON.parse(listed.stdout).commitments.length, 1);
  assert.equal(
    f.harness.inspection.sdk.callsTo("threads.sendMessage").length,
    0,
  );
});

test("an authority switch preserves the obligation and original link, with unknown status until explicit reconciliation", async (t) => {
  const f = fixture(t);
  const added = await f.add(["--task", "task_one"]);
  f.store.documents.write({
    botId: f.setup.botId,
    name: "TASKS.json",
    expectedRevision: 1,
    markdown: JSON.stringify({
      kind: "tasks",
      phase: "ready",
      boardId: "tracker_new",
    }),
    author: "fixture-user",
    reason: "Confirmed migration fixture",
  });
  const calls = f.harness.inspection.sdk.callsTo("plugins.callRpc").length;
  const found = await f.show(added.id);
  assert.equal(found.status, null);
  assert.equal(found.availability, "source-reconciliation-required");
  assert.equal(found.record.reference.boardId, "tracker_owned");
  assert.equal(found.revision, 1);
  assert.equal(
    f.harness.inspection.sdk.callsTo("plugins.callRpc").length,
    calls,
  );
});

test("a delayed Tasks response cannot supply status after the task authority changes", async (t) => {
  const f = fixture(t);
  const added = await f.add(["--task", "task_one"]);
  f.tasks.get("task_one")!.status = "done";
  const pause = f.pauseTaskRead();
  t.after(pause.release);
  const pending = f.show(added.id);
  await pause.started;
  f.store.documents.write({
    botId: f.setup.botId,
    name: "TASKS.json",
    expectedRevision: 1,
    markdown: JSON.stringify({
      kind: "tasks",
      phase: "ready",
      boardId: "tracker_new",
    }),
    author: "fixture-user",
    reason: "Migration while Tasks replies",
  });
  pause.release();
  const found = await pending;
  assert.equal(found.status, null);
  assert.equal(found.availability, "changed-during-read");
  assert.equal(found.record.reference.boardId, "tracker_owned");
});

test("a delayed old task response cannot override an explicitly relinked commitment", async (t) => {
  const f = fixture(t);
  const added = await f.add(["--task", "task_one"]);
  f.tasks.get("task_one")!.status = "done";
  f.tasks.get("task_two")!.status = "todo";
  const pause = f.pauseTaskRead();
  t.after(pause.release);
  const pending = f.show(added.id);
  await pause.started;
  const relink = await f.run([
    "commitment",
    "relink",
    f.setup.botId,
    added.id,
    "--task",
    "task_two",
    "--revision",
    "1",
    "--author",
    "fixture-user",
    "--reason",
    "Confirmed corrected reference",
    "--json",
  ]);
  assert.equal(relink.exitCode, 0, relink.stderr);
  assert.equal(JSON.parse(relink.stdout).status, "todo");
  pause.release();
  const found = await pending;
  assert.equal(found.status, null);
  assert.equal(found.availability, "changed-during-read");
  assert.equal(found.record.reference.taskId, "task_two");
  assert.equal(found.revision, 2);
  assert.equal((await f.show(added.id)).status, "todo");
});

test("creation replay retains original attribution and refuses changed authorship", async (t) => {
  const f = fixture(t);
  const added = await f.add();
  const differentAuthor = await f.run(
    added.args.map((arg) => (arg === "fixture-user" ? "another-user" : arg)),
  );
  assert.equal(differentAuthor.exitCode, 1);
  const differentReason = await f.run(
    added.args.map((arg) =>
      arg === "Explicit obligation" ? "A different request" : arg,
    ),
  );
  assert.equal(differentReason.exitCode, 1);
  assert.equal((await f.show(added.id)).revision, 1);
});
