import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import Database from "better-sqlite3";
import { fixture as memoryFixture } from "../memory/fixture.test.ts";
import { openSoul } from "../soul/store.ts";
import { openSetup } from "../setup/storage.ts";
import { openMemory } from "../memory/store.ts";
import { openCheckpoints, markdownExport } from "./store.ts";

function fixture(t: TestContext) {
  const f = memoryFixture(t),
    soul = openSoul(f.bb.storage, f.setup, () => {});
  const checkpoints = openCheckpoints(f.bb.storage, f.setup, soul);
  const request = {
    botId: f.bot.botId,
    requestId: randomUUID(),
    name: "Before edits",
    author: "fixture-user",
    reason: "Explicit checkpoint request",
  };
  function pages(id: string) {
    const result = [];
    let after;
    do {
      const page = checkpoints.page(f.bot.botId, id, after);
      result.push(page);
      after = page.nextCursor ?? undefined;
    } while (after);
    return result;
  }
  return { ...f, soul, checkpoints, request, pages };
}

test("checkpoint pins one consistent profile/SOUL/default/knowledge selection and exact replay retains it after edits", (t) => {
  const f = fixture(t);
  const note = f.memory.create(f.input()).entry;
  const saved = f.checkpoints.create(f.request);
  f.setup.profiles.rename({
    botId: f.bot.botId,
    expectedRevision: 1,
    name: "Renamed",
    author: "fixture-user",
    reason: "Later edit",
  });
  f.soul.update({
    botId: f.bot.botId,
    expectedRevision: 1,
    markdown: "A different soul",
    author: "fixture-user",
    reason: "Later edit",
  });
  f.soul.updateDefaults({
    botId: f.bot.botId,
    expectedRevision: 0,
    defaults: { main: { model: "later-model" }, worker: null, fallback: null },
    author: "fixture-user",
    reason: "Later edit",
  });
  f.memory.correct({
    botId: f.bot.botId,
    id: note.id,
    expectedRevision: 1,
    topic: "Changed",
    markdown: "Later note",
    basis: "fact",
    sources: ["artifact:later"],
    parents: [],
    author: "fixture-user",
    reason: "Later edit",
  });
  const replay = f.checkpoints.create(f.request);
  assert.equal(replay.replay, true);
  const { replay: _replay, ...metadata } = replay;
  const { replay: _first, ...original } = saved;
  assert.deepEqual(metadata, original);
  assert.equal(metadata.profile.name, "Bob");
  assert.equal(metadata.execution.revision, 0);
  const pages = f.pages(saved.checkpoint.id);
  assert.equal(pages.length, 2);
  const knowledge = pages.flatMap((p) =>
    p.document?.kind === "knowledge" ? [p.document] : [],
  );
  assert.equal(knowledge[0]?.revision, 1);
  assert.equal(knowledge[0]?.record.markdown, "Prefer concise evidence.");
  assert.equal(knowledge[0]?.record.parents.length, 0);
  assert.throws(
    () => f.checkpoints.create({ ...f.request, name: "Different" }),
    /different options/,
  );
});

test("old checkpoints apply new exclusions to original and derived notes without exporting forgotten text", (t) => {
  const f = fixture(t);
  const original = f.memory.create(
    f.input({ markdown: "Sensitive original" }),
  ).entry;
  const derived = f.memory.create(
    f.input({
      markdown: "Sensitive derivative",
      sources: [],
      parents: [{ id: original.id, revision: 1 }],
    }),
  ).entry;
  const saved = f.checkpoints.create(f.request);
  assert.equal(saved.selectedDocuments, 3);
  f.memory.forget(f.bot.botId, original.id, 1, "fixture-user");
  const pages = f.pages(saved.checkpoint.id);
  assert.equal(pages.length, 1);
  const output = JSON.stringify(pages);
  assert.equal(output.includes("Sensitive"), false);
  assert.equal(output.includes(derived.id), false);
  assert.equal(pages[0]?.document?.kind, "soul");
  assert.equal(
    f.checkpoints.create({ ...f.request, requestId: randomUUID() })
      .selectedDocuments,
    1,
  );
});

test("checkpoint creation rolls back metadata and entries together after an actual SQLite insertion failure", (t) => {
  const f = fixture(t);
  f.db.exec(
    "CREATE TRIGGER fail_checkpoint BEFORE INSERT ON checkpoint_entries BEGIN SELECT RAISE(ABORT,'fixture reference failure'); END",
  );
  assert.throws(
    () => f.checkpoints.create(f.request),
    /fixture reference failure/,
  );
  assert.deepEqual(f.checkpoints.list(f.bot.botId).items, []);
  f.db.exec("DROP TRIGGER fail_checkpoint");
  assert.equal(f.checkpoints.create(f.request).replay, false);
});

test("a second SQLite capture writer cannot interleave the checkpoint revision selection", (t) => {
  const f = fixture(t);
  const path = (
    f.db.pragma("database_list") as { name: string; file: string }[]
  ).find((row) => row.name === "main")!.file;
  assert.ok(path);
  const connection = new Database(path);
  t.after(() => connection.close());
  connection.pragma("busy_timeout = 0");
  const storage = { ...f.bb.storage, database: () => connection };
  const other = openMemory(storage, openSetup(storage), () => {});
  const note = f.input({ markdown: "Concurrent memory" });
  let probes = 0;
  f.db.function("checkpoint_writer_probe", () => {
    probes++;
    assert.throws(
      () => other.create(note),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "SQLITE_BUSY",
    );
    return 0;
  });
  f.db.exec(
    "CREATE TRIGGER checkpoint_writer_probe BEFORE INSERT ON checkpoints BEGIN SELECT checkpoint_writer_probe(); END",
  );
  const saved = f.checkpoints.create(f.request);
  assert.equal(probes, 1);
  assert.equal(saved.selectedDocuments, 1);
  assert.equal(other.create(note).entry.availability, "available");
  assert.equal(f.pages(saved.checkpoint.id).length, 1);
  assert.equal(
    f.checkpoints.create({ ...f.request, requestId: randomUUID() })
      .selectedDocuments,
    2,
  );
});

test("exports preserve execution document provenance and omit operational/session/settings state", (t) => {
  const f = fixture(t);
  f.soul.updateDefaults({
    botId: f.bot.botId,
    expectedRevision: 0,
    defaults: {
      main: { providerId: "fixture-provider", model: "fixture-model" },
      worker: {},
      fallback: null,
    },
    author: "fixture-user",
    reason: "Explicit defaults",
  });
  for (const name of ["TASKS.json", "COMMITMENT:fixture.json", "PRIVATE.json"])
    f.setup.documents.write({
      botId: f.bot.botId,
      name,
      expectedRevision: 0,
      markdown: "session-token-fixture-not-a-secret",
      author: "fixture-user",
      reason: "Excluded fixture",
    });
  f.bb.storage.kv.set("credentials-fixture", "settings-fixture-not-a-secret");
  f.memory.create(
    f.input({
      kind: "summary",
      boundary: {
        streamId: "thread:fixture",
        from: 1,
        through: 2,
        expectedRevision: 0,
      },
    }),
  );
  const saved = f.checkpoints.create(f.request),
    page = f.checkpoints.page(f.bot.botId, saved.checkpoint.id);
  assert.equal(saved.selectedDocuments, 1);
  assert.equal(page.execution.revision, 1);
  assert.equal(
    page.execution.documentId,
    f.setup.documents.get(f.bot.botId, "EXECUTION.json")?.id,
  );
  assert.equal(page.execution.defaults.main.model, "fixture-model");
  const output = markdownExport(page);
  assert.equal(output.includes("session-token-fixture"), false);
  assert.equal(output.includes("settings-fixture"), false);
  assert.equal(output.includes("CAPTURE:"), false);
  assert.equal(output.includes("fixture-model"), true);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("bounded checkpoint listing and document cursors reject foreign bot/checkpoint references", (t) => {
  const f = fixture(t);
  for (let i = 0; i < 12; i++)
    f.checkpoints.create({
      ...f.request,
      requestId: randomUUID(),
      name: `Checkpoint ${i}`,
    });
  const first = f.checkpoints.list(f.bot.botId);
  assert.equal(first.items.length, 10);
  assert.ok(first.nextCursor);
  const second = f.checkpoints.list(f.bot.botId, first.nextCursor);
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, null);
  assert.throws(
    () => f.checkpoints.show(f.other.botId, first.items[0]!.id),
    /not found/,
  );
  assert.throws(
    () => f.checkpoints.list(f.other.botId, first.nextCursor!),
    /not found/,
  );
  assert.throws(
    () => f.checkpoints.page(f.bot.botId, first.items[0]!.id, "doc_foreign"),
    /cursor/,
  );
});
