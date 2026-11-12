import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fixture } from "./migration-fixture.test.ts";

test("a delayed source-availability response cannot advertise the old board after migration", async (t) => {
  const f = await fixture(t);
  f.afterRead(() => f.source("board_new", 1));
  const found = (await f.harness.behavior.callRpc("taskSource", {
    botId: f.setup.botId,
  })) as { availability: string; boardId: string; file: null };
  assert.equal(found.availability, "changed-during-read");
  assert.equal(found.boardId, "board_new");
  assert.equal(found.file, null);
});

test("a Markdown read after a concurrent authority change refuses to return the old file as current", async (t) => {
  const f = await fixture(t);
  const hash = await f.prepare("Old authoritative file\n");
  assert.equal((await f.run(f.args(["--markdown-hash", hash]))).exitCode, 0);
  f.afterRead(() => f.source("board_new", 2));
  const result = await f.run(["tasks", "read", f.setup.botId, "--json"]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /authority changed/);
  assert.equal(result.stdout.includes("Old authoritative file"), false);
  assert.equal(
    await readFile(join(f.home, "tasks.md"), "utf8"),
    "Old authoritative file\n",
  );
});

test("confirmed migration does not copy linked status or relink commitments; explicit reconciliation retains both references", async (t) => {
  const f = await fixture(t);
  const args = [
    "commitment",
    "add",
    f.setup.botId,
    "--what",
    "Mapped obligation",
    "--task",
    "task_old",
    "--author",
    "fixture-user",
    "--reason",
    "Original obligation",
    "--request-id",
    randomUUID(),
    "--json",
  ];
  const created = await f.run(args);
  assert.equal(created.exitCode, 0, created.stderr);
  const old = JSON.parse(created.stdout);
  assert.equal((await f.run(f.args())).exitCode, 0);
  const replay = await f.run(args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  const linked = JSON.parse(replay.stdout);
  assert.equal(linked.id, old.id);
  assert.equal(linked.status, null);
  assert.equal(linked.availability, "source-reconciliation-required");
  assert.equal(linked.record.reference.taskId, "task_old");
  const reconciled = await f.run([
    "commitment",
    "relink",
    f.setup.botId,
    old.id,
    "--task",
    "task_new",
    "--revision",
    "1",
    "--author",
    "fixture-user",
    "--reason",
    "Inspected OLD-1 to NEW-1 mapping",
    "--json",
  ]);
  assert.equal(reconciled.exitCode, 0, reconciled.stderr);
  const current = JSON.parse(reconciled.stdout);
  assert.equal(current.record.reference.taskId, "task_new");
  assert.equal(current.status, "todo");
  assert.equal(current.revision, 2);
  const first = f.store.documents.revision(
    f.setup.botId,
    `COMMITMENT:${old.id.slice(4)}.json`,
    1,
  );
  assert.equal(JSON.parse(first.markdown).reference.taskId, "task_old");
});

test("assisted board migration atomically retains its old authority, mapping and audit; exact replay survives reload without reverting a later choice", async (t) => {
  const f = await fixture(t);
  const args = f.args();
  const result = await f.run(args);
  assert.equal(result.exitCode, 0, result.stderr);
  const saved = JSON.parse(result.stdout);
  assert.equal(saved.current.revision, 2);
  assert.equal(saved.migration.from.boardId, "board_old");
  assert.equal(saved.migration.to.boardId, "board_new");
  assert.equal(saved.migration.request.mapping.length, 1);
  assert.equal(saved.migration.request.author, "fixture-user");
  assert.equal(
    saved.current.source.migrationId,
    saved.migration.request.requestId,
  );
  assert.equal(
    JSON.parse(
      f.store.documents.revision(f.setup.botId, "TASKS.json", 1).markdown,
    ).boardId,
    "board_old",
  );
  await f.reload();
  f.source("board_old", 2);
  const calls = f.harness.inspection.sdk.callsTo("plugins.callRpc").length;
  const replay = await f.run(args);
  assert.equal(replay.exitCode, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).replay, true);
  assert.equal(JSON.parse(replay.stdout).current.revision, 3);
  assert.equal(JSON.parse(replay.stdout).current.source.boardId, "board_old");
  assert.equal(
    f.harness.inspection.sdk.callsTo("plugins.callRpc").length,
    calls,
  );
  const altered = await f.run(
    args.map((arg) => (arg === "fixture-user" ? "other-author" : arg)),
  );
  assert.equal(altered.exitCode, 1);
});

test("a prepared Markdown migration reads only the original home host and preserves the exact file plus source history", async (t) => {
  const f = await fixture(t);
  const markdown =
    "# Manually inspected mapping\n- [ ] OLD-1 → new file obligation\n";
  const hash = await f.prepare(markdown);
  const args = f.args(["--markdown-hash", hash]);
  const result = await f.run(args);
  assert.equal(result.exitCode, 0, result.stderr);
  const saved = JSON.parse(result.stdout);
  assert.equal(saved.current.source.kind, "markdown");
  assert.equal(saved.current.source.hostId, "host_original");
  assert.equal(saved.current.source.path, join(f.home, "tasks.md"));
  assert.equal(saved.migration.request.target.expectedHash, hash);
  assert.equal(await readFile(join(f.home, "tasks.md"), "utf8"), markdown);
  const receipt = await f.run([
    "tasks",
    "migration-show",
    f.setup.botId,
    saved.migration.request.requestId,
    "--json",
  ]);
  assert.equal(receipt.exitCode, 0, receipt.stderr);
  assert.deepEqual(JSON.parse(receipt.stdout), saved.migration);
  const back = await f.run(f.args(["--board", "board_new"], randomUUID(), 2));
  assert.equal(back.exitCode, 0, back.stderr);
  assert.equal(
    JSON.parse(back.stdout).migration.from.path,
    join(f.home, "tasks.md"),
  );
  assert.equal(await readFile(join(f.home, "tasks.md"), "utf8"), markdown);
});

test("destination outage, missing/changed file, unknown board and malformed mapping never change authority or create receipts", async (t) => {
  const f = await fixture(t);
  f.offline();
  const unavailable = await f.run(f.args());
  assert.equal(unavailable.exitCode, 1);
  for (const args of [
    f.args(["--markdown-hash", "a".repeat(64)]),
    f.args().map((arg) => (arg.startsWith('[{"from"') ? "[]" : arg)),
  ])
    assert.equal((await f.run(args)).exitCode, 1);
  f.online();
  assert.equal((await f.run(f.args(["--board", "board_missing"]))).exitCode, 1);
  assert.equal((await f.run(f.args(["--board", "board_old"]))).exitCode, 1);
  await f.prepare("Prepared but different\n");
  const stale = await f.run(f.args(["--markdown-hash", "a".repeat(64)]));
  assert.equal(stale.exitCode, 1);
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json")!.revision, 1);
  assert.equal(
    (
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM documents WHERE name GLOB 'TASKS-MIGRATION:*'",
        )
        .get() as { n: number }
    ).n,
    0,
  );
});

test("source changes or cancellation during destination validation refuse the confirmation without a saved receipt", async (t) => {
  const f = await fixture(t);
  const args = f.args();
  f.afterRead(() => f.source("board_other", 1));
  const raced = await f.run(args);
  assert.equal(raced.exitCode, 1);
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json")!.revision, 2);
  const controller = new AbortController();
  f.afterRead(() => controller.abort(new Error("User canceled confirmation")));
  const canceled = await f.run(
    f.args(["--board", "board_new"], randomUUID(), 2),
    { threadId: "thr_main", signal: controller.signal },
  );
  assert.equal(canceled.exitCode, 1);
  assert.equal(
    (
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM documents WHERE name GLOB 'TASKS-MIGRATION:*'",
        )
        .get() as { n: number }
    ).n,
    0,
  );
});

test("receipt and authority roll back together if saving the source revision fails", async (t) => {
  const f = await fixture(t);
  const doc = f.store.documents.get(f.setup.botId, "TASKS.json")!;
  f.db.exec(
    `CREATE TRIGGER reject_migration BEFORE INSERT ON document_revisions WHEN NEW.document_id = '${doc.id}' AND NEW.revision = 2 BEGIN SELECT RAISE(ABORT, 'injected source failure'); END`,
  );
  assert.equal((await f.run(f.args())).exitCode, 1);
  assert.equal(f.store.documents.get(f.setup.botId, "TASKS.json")!.revision, 1);
  assert.equal(
    (
      f.db
        .prepare(
          "SELECT COUNT(*) AS n FROM documents WHERE name GLOB 'TASKS-MIGRATION:*'",
        )
        .get() as { n: number }
    ).n,
    0,
  );
});

test("cross-bot owners cannot confirm or read a migration receipt and incomplete setup cannot be migrated", async (t) => {
  const f = await fixture(t);
  const other = f.store.profiles.create({
    name: "Alice",
    author: "fixture-user",
    reason: "Other bot fixture",
  });
  f.store.conversations.bindInitialThread(
    other.mainConversationId,
    "thr_alice",
  );
  const args = f.args();
  const refused = await f.run(args, { threadId: "thr_alice" });
  assert.equal(refused.exitCode, 1);
  assert.equal(f.harness.inspection.sdk.callsTo("plugins.callRpc").length, 0);
  const saved = await f.run(args);
  assert.equal(saved.exitCode, 0, saved.stderr);
  const id = JSON.parse(saved.stdout).migration.request.requestId;
  assert.equal(
    (
      await f.run(["tasks", "migration-show", f.setup.botId, id], {
        threadId: "thr_alice",
      })
    ).exitCode,
    1,
  );
  f.store.documents.write({
    botId: f.setup.botId,
    name: "TASKS.json",
    expectedRevision: 2,
    markdown: JSON.stringify({
      kind: "tasks",
      phase: "creating",
      name: "Incomplete",
      prefix: "INC",
    }),
    author: "fixture-user",
    reason: "Incomplete setup fixture",
  });
  assert.equal(
    (await f.run(f.args(["--board", "board_new"], randomUUID(), 3))).exitCode,
    1,
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
});
