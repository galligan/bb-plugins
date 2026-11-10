import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import { openRadioStorage } from "./storage.ts";
import {
  transmissionFixture,
  errorCode as code,
} from "./transmission-fixture.ts";

function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  return { ...host, ...transmissionFixture(host.bb) };
}

test("durable sends snapshot repaired addresses, canonical refs and tags without implying receipt", async () => {
  const f = fixture();
  try {
    const result = f.store.transmissions.send(f.context, {
      ...f.input,
      body: "@WORKER ch:one Ready #Ship__It #ship-it.",
      recipientIds: [f.target.id, f.target.id],
      refs: [
        { kind: "participant", id: f.target.id },
        { kind: "channel", id: f.project.channelId },
        { kind: "url", url: "https://example.com/pr/1" },
      ],
    });
    assert.equal(result.state, "sent");
    assert.equal(result.replayed, false);
    const tx = result.transmission;
    assert.deepEqual(tx.recipientIds, [f.target.id]);
    assert.deepEqual(tx.tags, ["ship-it"]);
    assert.equal(tx.body, "@WORKER ch:one Ready #Ship__It #ship-it.");
    assert.equal(tx.tokens[0]!.canonical, "@worker");
    assert.equal(tx.tokens[0]!.targetId, f.target.id);
    assert.equal(tx.tokens[1]!.kind, "channel-reference");
    assert.equal(tx.tokens[1]!.targetId, f.project.channelId);
    f.store.projects.rename(f.project.id, "renamed");
    f.store.handles.rename(f.project.id, f.target.id, "new-name", {
      kind: "human",
      actorId: f.human.id,
    });
    f.bb.storage.database().close();
    const reopened = openRadioStorage(f.bb.storage);
    assert.deepEqual(reopened.transmissions.get(tx.id, f.context.scope), tx);
    assert.equal("received" in tx, false);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("lost-response replay survives rename/reclaim while changed key payload conflicts", async () => {
  const f = fixture();
  try {
    const request = { ...f.input, body: "@worker ready" };
    const first = f.store.transmissions.send(f.context, request);
    const replacement = f.store.identities.createActor();
    f.store.handles.reclaim(f.project.id, replacement.id, "worker", {
      kind: "human",
      actorId: f.human.id,
    });
    f.bb.storage.database().close();
    const reopened = openRadioStorage(f.bb.storage);
    const replay = reopened.transmissions.send(f.context, request);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.transmission, first.transmission);
    assert.deepEqual(replay.transmission.recipientIds, [f.target.id]);
    for (const change of [
      { body: "Different" },
      { recipientIds: [replacement.id] },
      { refs: [{ kind: "channel", id: f.project.channelId }] },
    ])
      assert.throws(
        () => reopened.transmissions.send(f.context, { ...request, ...change }),
        code("conflict"),
      );
    assert.throws(
      () =>
        reopened.transmissions.send(
          { ...f.context, sessionId: undefined },
          request,
        ),
      code("conflict"),
    );
    const next = reopened.transmissions.send(f.context, {
      ...request,
      idempotencyKey: "new",
    });
    assert.deepEqual(next.transmission.recipientIds, [replacement.id]);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("recipient write failure rolls back tx/idempotency and retry accepts exactly once", async () => {
  const f = fixture();
  try {
    const db = f.bb.storage.database();
    db.exec(
      "CREATE TRIGGER fail_recipient BEFORE INSERT ON transmission_recipients BEGIN SELECT RAISE(ABORT, 'write failed'); END",
    );
    const request = { ...f.input, body: "@worker ready" };
    assert.throws(
      () => f.store.transmissions.send(f.context, request),
      /write failed/,
    );
    assert.equal(
      db
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM transmissions")
        .get()!.n,
      0,
    );
    db.exec("DROP TRIGGER fail_recipient");
    const sent = f.store.transmissions.send(f.context, request);
    assert.equal(sent.replayed, false);
    assert.equal(
      f.store.transmissions.send(f.context, request).transmission.id,
      sent.transmission.id,
    );
    assert.equal(
      db
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM transmissions")
        .get()!.n,
      1,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("bounded channel scans use stable cursors with no cross-channel leak or receipt side effects", async () => {
  const f = fixture();
  try {
    const ids = [];
    for (let i = 0; i < 4; i++) {
      ids.push(
        f.store.transmissions.send(f.context, {
          ...f.input,
          idempotencyKey: String(i),
        }).transmission.id,
      );
      f.store.transmissions.send(
        { ...f.context, scope: { projectIds: [f.other.id] } },
        {
          ...f.input,
          channelId: f.other.channelId,
          idempotencyKey: `other-${i}`,
        },
      );
    }
    const first = f.store.transmissions.scan(f.context.scope, {
      channelId: f.project.channelId,
      limit: 2,
    });
    assert.deepEqual(
      first.items.map(({ id }) => id),
      ids.slice(0, 2),
    );
    assert.equal(first.hasMore, true);
    const next = f.store.transmissions.scan(f.context.scope, {
      channelId: f.project.channelId,
      limit: 2,
      after: first.nextCursor,
    });
    assert.deepEqual(
      next.items.map(({ id }) => id),
      ids.slice(2),
    );
    assert.equal(next.hasMore, false);
    assert.deepEqual(
      f.store.transmissions.scan(f.context.scope, {
        channelId: f.project.channelId,
        after: next.nextCursor,
      }).items,
      [],
    );
    for (const change of [
      { limit: 51 },
      { limit: 0 },
      { after: -1 },
      { after: 0.5 },
    ])
      assert.throws(
        () =>
          f.store.transmissions.scan(f.context.scope, {
            channelId: f.project.channelId,
            ...change,
          }),
        code("invalid_input"),
      );
    assert.throws(
      () =>
        f.store.transmissions.scan(f.context.scope, {
          channelId: f.other.channelId,
        }),
      code("not_found"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
