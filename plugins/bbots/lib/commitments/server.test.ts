import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { fixture } from "./fixtures.test.ts";

test("unlinked obligations own revisioned status, use SQL logical owners and replay the same creation after close/reload", async (t) => {
  const f = fixture(t);
  const added = await f.add(["--evidence", "thread:original"]);
  assert.equal(added.result.exitCode, 0, added.result.stderr);
  assert.equal(added.data.record.ownerConversationId, f.worker.conversationId);
  assert.equal(added.data.status, "open");
  assert.equal(added.data.author, "fixture-user");
  const closed = await f.close(added.id, 1);
  assert.equal(closed.exitCode, 0, closed.stderr);
  assert.equal(JSON.parse(closed.stdout).status, "closed");
  assert.equal(JSON.parse(closed.stdout).revision, 2);
  assert.equal((await f.close(added.id, 1)).exitCode, 1);
  await f.reload();
  const replay = await f.run(added.args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).id, added.id);
  assert.equal(JSON.parse(replay.stdout).status, "closed");
  assert.equal(JSON.parse(replay.stdout).revision, 2);
  const changed = await f.run(
    added.args.map((arg) =>
      arg === "Prepare evidence" ? "Different obligation" : arg,
    ),
  );
  assert.equal(changed.exitCode, 1);
  const list = await f.run(["commitment", "list", f.setup.botId, "--json"]);
  assert.equal(JSON.parse(list.stdout).commitments.length, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
});

test("linked task status is read live without persisting a shadow status, including during outage and deletion", async (t) => {
  const f = fixture(t);
  const added = await f.add(["--task", "task_one"]);
  assert.equal(added.result.exitCode, 0, added.result.stderr);
  assert.equal(added.data.status, "todo");
  assert.deepEqual(added.data.record.reference, {
    kind: "tasks",
    boardId: "tracker_owned",
    taskId: "task_one",
  });
  assert.equal("status" in added.data.record.reference, false);
  const before = f.store.documents.get(
    f.setup.botId,
    `COMMITMENT:${added.id.slice(4)}.json`,
  );
  f.tasks.get("task_one")!.status = "done";
  assert.equal((await f.show(added.id)).status, "done");
  assert.deepEqual(
    f.store.documents.get(
      f.setup.botId,
      `COMMITMENT:${added.id.slice(4)}.json`,
    ),
    before,
  );
  assert.equal((await f.close(added.id, 1)).exitCode, 1);
  f.offline();
  const unavailable = await f.show(added.id);
  assert.equal(unavailable.status, null);
  assert.equal(unavailable.availability, "unavailable");
  f.online();
  f.tasks.delete("task_one");
  const missing = await f.show(added.id);
  assert.equal(missing.status, null);
  assert.equal(missing.availability, "missing");
  assert.deepEqual(
    f.store.documents.get(
      f.setup.botId,
      `COMMITMENT:${added.id.slice(4)}.json`,
    ),
    before,
  );
  assert.equal(f.harness.inspection.registrations.services.length, 0);
});

test("an outage can retain the obligation and explicit source reference without claiming a verified task status", async (t) => {
  const f = fixture(t);
  f.offline();
  const added = await f.add(["--task", "task_one"]);
  assert.equal(added.result.exitCode, 0, added.result.stderr);
  assert.equal(added.data.status, null);
  assert.equal(added.data.availability, "unavailable");
  assert.equal(added.data.record.reference.taskId, "task_one");
  f.online();
  assert.equal((await f.show(added.id)).status, "todo");
});

test("wrong-board status is refused and deliberate relinking preserves the original reference revision", async (t) => {
  const f = fixture(t);
  const added = await f.add(["--task", "task_foreign"]);
  assert.equal(added.result.exitCode, 0);
  assert.equal(added.data.status, null);
  assert.equal(added.data.availability, "wrong-source");
  const result = await f.run([
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
  assert.equal(result.exitCode, 0, result.stderr);
  const current = JSON.parse(result.stdout);
  assert.equal(current.revision, 2);
  assert.equal(current.status, "done");
  const initial = f.store.documents.revision(
    f.setup.botId,
    `COMMITMENT:${added.id.slice(4)}.json`,
    1,
  );
  assert.equal(JSON.parse(initial.markdown).reference.taskId, "task_foreign");
  const stale = await f.run([
    "commitment",
    "relink",
    f.setup.botId,
    added.id,
    "--task",
    "task_one",
    "--revision",
    "1",
    "--author",
    "fixture-user",
    "--reason",
    "Stale edit",
  ]);
  assert.equal(stale.exitCode, 1);
  const unlink = await f.run([
    "commitment",
    "relink",
    f.setup.botId,
    added.id,
    "--revision",
    "2",
    "--author",
    "fixture-user",
    "--reason",
    "Cannot create a shadow",
  ]);
  assert.equal(unlink.exitCode, 1);
});

test("Markdown references retain one file authority and explicit manual status, never parsing or copying a checkbox", async (t) => {
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
    reason: "Confirmed source fixture",
  });
  const added = await f.add([
    "--markdown-reference",
    "Follow-up under Evidence",
  ]);
  assert.equal(added.result.exitCode, 0, added.result.stderr);
  assert.equal(added.data.status, null);
  assert.equal(added.data.availability, "manual-source-read");
  assert.equal(added.data.record.reference.path, "/home/bob/tasks.md");
  assert.equal("status" in added.data.record.reference, false);
  assert.equal((await f.close(added.id, 1)).exitCode, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("plugins.callRpc").length, 0);
  assert.equal(f.harness.inspection.experimental_hostRpcCalls.length, 0);
});

test("wrong-bot callers and owners cannot read, create or close obligations using title or metadata assumptions", async (t) => {
  const f = fixture(t);
  const other = f.store.profiles.create({
    name: "Alice",
    author: "fixture-user",
    reason: "Another bot",
  });
  f.store.conversations.bindInitialThread(
    other.mainConversationId,
    "thr_alice",
  );
  const invalid = await f.add(["--owner", other.mainConversationId]);
  assert.equal(invalid.result.exitCode, 1);
  const added = await f.add();
  assert.equal(added.result.exitCode, 0);
  for (const args of [
    ["commitment", "list", f.setup.botId],
    ["commitment", "show", f.setup.botId, added.id],
    ["brief", f.setup.botId],
    added.args,
  ]) {
    const refused = await f.run(args, { threadId: "thr_alice" });
    assert.equal(refused.exitCode, 1);
    assert.match(refused.stderr, /another bot/);
  }
  assert.equal((await f.show(added.id)).revision, 1);
});

test("commitment pagination stays bounded and stable across new arrivals, while the brief clips content", async (t) => {
  const f = fixture(t);
  const ids = [];
  for (let i = 0; i < 21; i++) {
    const added = await f.add([], randomUUID(), "x".repeat(4096));
    assert.equal(added.result.exitCode, 0);
    ids.push(added.id);
  }
  const first = JSON.parse(
    (await f.run(["commitment", "list", f.setup.botId, "--json"])).stdout,
  );
  assert.equal(first.commitments.length, 20);
  assert.ok(first.nextCursor);
  await f.add();
  const second = JSON.parse(
    (
      await f.run([
        "commitment",
        "list",
        f.setup.botId,
        "--after",
        first.nextCursor,
        "--json",
      ])
    ).stdout,
  );
  assert.deepEqual(
    second.commitments.map((x: { id: string }) => x.id),
    [ids[0]],
  );
  assert.equal(second.nextCursor, null);
  const brief = JSON.parse(
    (await f.run(["brief", f.setup.botId, "--json"])).stdout,
  );
  assert.equal(brief.commitments.length, 10);
  assert.ok(brief.commitmentsNextCursor);
  assert.ok(
    brief.commitments.every((x: { what: string }) => x.what.length <= 512),
  );
  assert.equal(brief.unavailable.includes("commitments"), false);
  assert.ok(brief.contract);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
});
