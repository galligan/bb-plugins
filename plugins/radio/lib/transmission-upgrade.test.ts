import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS, openRadioStorage } from "./storage.ts";
import { IdentityRegistry } from "./identity-registry.ts";
import { ProjectRegistry } from "./project-registry.ts";
import { errorCode } from "./transmission-fixture.ts";

test("pre-protocol transmission schema and exact request encoding survive appended mode/expectation upgrade", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const db = bb.storage.database();
    const firstAlter = MIGRATIONS.findIndex((sql) =>
      sql.startsWith("ALTER TABLE transmissions ADD COLUMN request_mode"),
    );
    assert.ok(firstAlter > 0);
    bb.storage.migrate(db, MIGRATIONS.slice(0, firstAlter));
    db.prepare(
      "INSERT INTO station(singleton, id) VALUES (1, 'station_legacy')",
    ).run();
    const actor = new IdentityRegistry(db, "station_legacy").createActor();
    const project = new ProjectRegistry(db).register("proj_one", "one").project;
    const request = {
      channelId: project.channelId,
      body: "Original body",
      idempotencyKey: "old-key",
    };
    // Exact encoding shipped before mode/expectation fields existed.
    const canonical = JSON.stringify({
      sessionId: null,
      channelId: project.channelId,
      body: request.body,
      refs: [],
      recipientIds: [],
      idempotencyKey: request.idempotencyKey,
    });
    db.prepare(
      `INSERT INTO transmissions(id, author_id, session_id, channel_id, body, created_at,
      reply_to_id, refs_json, tags_json, tokens_json, caller_key, idempotency_key, request_json)
      VALUES ('tx_legacy', ?, NULL, ?, ?, '2026-11-10T00:00:00Z', NULL, '[]', '[]', '[]', ?, ?, ?)`,
    ).run(
      actor.id,
      project.channelId,
      request.body,
      JSON.stringify(["actor", actor.id]),
      request.idempotencyKey,
      canonical,
    );
    const store = openRadioStorage(bb.storage);
    const context = {
      authorId: actor.id,
      caller: { kind: "actor" as const, actorId: actor.id },
      scope: { projectIds: [project.id] },
    };
    const replay = store.transmissions.send(context, request);
    assert.equal(replay.replayed, true);
    assert.equal(replay.transmission.id, "tx_legacy");
    assert.equal(replay.transmission.requestMode, "discussion");
    assert.equal(replay.transmission.requireAck, false);
    assert.equal(replay.transmission.expectReply, false);
    assert.equal(
      store.transmissions.send(context, {
        ...request,
        requestMode: "discussion",
        requireAck: false,
        expectReply: false,
      }).transmission.id,
      "tx_legacy",
    );
    for (const change of [
      { requestMode: "exclusive" },
      { requireAck: true },
      { expectReply: true },
    ])
      assert.throws(
        () => store.transmissions.send(context, { ...request, ...change }),
        errorCode("conflict"),
      );
    const exclusive = store.transmissions.send(context, {
      ...request,
      idempotencyKey: "new",
      requestMode: "exclusive",
      requireAck: true,
      expectReply: true,
    }).transmission;
    assert.equal(exclusive.requestMode, "exclusive");
    assert.equal(exclusive.requireAck, true);
    assert.equal(exclusive.expectReply, true);
    assert.equal(
      db
        .prepare<[], { n: number }>(
          "SELECT count(*) AS n FROM exclusive_claims",
        )
        .get()!.n,
      1,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
