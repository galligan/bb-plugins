import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { commitmentFixture } from "./commitment-fixture.ts";
import { errorCode } from "./transmission-fixture.ts";
function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  return { ...host, ...commitmentFixture(host.bb) };
}

test("broadcasts select exact channels, dedupe overlaps and keep two sessions of one actor distinct", async () => {
  const f = fixture();
  try {
    const sub = f.store.projects.addSubchannel(f.project.id, "sub").channel;
    const second = f.store.identities.registerThread(
      "thr_secondWorker",
      f.target.id,
    );
    const secondContext = { ...f.workerContext, sessionId: second.id };
    f.store.subscriptions.set(f.workerContext, {
      kind: "listen",
      channelId: f.project.channelId,
    });
    f.store.subscriptions.set(secondContext, {
      kind: "listen",
      channelId: sub.id,
    });
    const send = (body: string, idempotencyKey: string) =>
      f.store.transmissions.send(f.context, {
        ...f.input,
        body,
        idempotencyKey,
      }).transmission;
    const main = send("@ch:one Main only", "main");
    assert.deepEqual(main.recipientIds, [f.worker.id]);
    assert.deepEqual(main.audiences, [
      { channelId: f.project.channelId, eligibleCount: 1 },
    ]);
    assert.deepEqual(send("@ch:one/sub Sub only", "sub").recipientIds, [
      second.id,
    ]);
    f.store.subscriptions.set(secondContext, {
      kind: "listen",
      channelId: f.project.channelId,
    });
    const both = send(
      "@ch:one @ch:one/sub @ch:one @worker Both sessions and actor",
      "both",
    );
    assert.deepEqual(
      both.recipientIds,
      [f.worker.id, second.id, f.target.id].sort(),
    );
    assert.equal(both.audiences.length, 2);
    assert.equal(both.audiences[0]!.eligibleCount, 2);
    const ref = send("ch:one/sub Reference only", "ref");
    assert.deepEqual(ref.recipientIds, []);
    assert.deepEqual(ref.audiences, []);
    const literal = send('"@ch:one" `@ch:one/sub` \\@ch:one', "literal");
    assert.deepEqual(literal.audiences, []);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("mute/unlisten and later listeners change only future snapshots, not direct targets, replay or obligations", async () => {
  const f = fixture();
  try {
    f.store.subscriptions.set(f.workerContext, {
      kind: "listen",
      channelId: f.project.channelId,
    });
    const request = {
      ...f.input,
      body: "@ch:one Confirm",
      idempotencyKey: "broadcast",
      requireAck: true,
    };
    const first = f.store.transmissions.send(f.context, request).transmission;
    const commitment = f.store.commitments.act(f.workerContext, {
      kind: "wilco",
      txId: first.id,
      targetId: f.worker.id,
      idempotencyKey: "accept",
    }).commitment;
    f.store.subscriptions.set(f.workerContext, {
      kind: "mute",
      channelId: f.project.channelId,
    });
    const late = f.store.identities.registerThread(
      "thr_lateWorker",
      f.target.id,
    );
    f.store.subscriptions.set(
      { ...f.workerContext, sessionId: late.id },
      { kind: "listen", channelId: f.project.channelId },
    );
    const next = f.store.transmissions.send(f.context, {
      ...request,
      idempotencyKey: "next",
    }).transmission;
    assert.deepEqual(next.recipientIds, [late.id]);
    assert.deepEqual(
      f.store.transmissions.send(f.context, request).transmission,
      first,
    );
    const direct = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "direct",
      recipientIds: [f.worker.id],
    }).transmission;
    assert.deepEqual(direct.recipientIds, [f.worker.id]);
    f.store.subscriptions.set(f.workerContext, {
      kind: "unlisten",
      channelId: f.project.channelId,
    });
    assert.deepEqual(
      f.store.transmissions.get(first.id, f.context.scope).recipientIds,
      [f.worker.id],
    );
    assert.equal(
      f.store.responses.summary(f.context.scope, first.id).length,
      1,
    );
    assert.equal(
      f.store.responses.summary(f.context.scope, first.id)[0]!.ackAt,
      null,
    );
    assert.equal(
      f.store.commitments.get(f.context.scope, commitment.id).status,
      "open",
    );
    assert.equal(
      f.store.responses.summary(f.context.scope, first.id)[0]!
        .receivedEndpoints,
      0,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("empty audiences are explicit, oversized audiences fail without accepting a key or partial fanout", async () => {
  const f = fixture();
  try {
    const empty = f.store.transmissions.send(f.context, {
      ...f.input,
      body: "@ch:one Empty",
      idempotencyKey: "empty",
    });
    assert.equal(empty.state, "sent");
    assert.deepEqual(empty.transmission.recipientIds, []);
    assert.deepEqual(empty.transmission.audiences, [
      { channelId: f.project.channelId, eligibleCount: 0 },
    ]);
    const actors = [];
    for (let index = 0; index < 101; index++) {
      const actor = f.store.identities.createActor();
      actors.push(actor);
      f.store.subscriptions.set(
        {
          authorId: actor.id,
          caller: { kind: "actor", actorId: actor.id },
          scope: f.context.scope,
        },
        { kind: "listen", channelId: f.project.channelId },
      );
    }
    const request = {
      ...f.input,
      body: "@ch:one Overflow",
      idempotencyKey: "overflow",
    };
    assert.throws(
      () => f.store.transmissions.send(f.context, request),
      /exceeds 100/,
    );
    const first = actors[0]!;
    f.store.subscriptions.set(
      {
        authorId: first.id,
        caller: { kind: "actor", actorId: first.id },
        scope: f.context.scope,
      },
      { kind: "unlisten", channelId: f.project.channelId },
    );
    const retry = f.store.transmissions.send(f.context, request);
    assert.equal(retry.replayed, false);
    assert.equal(retry.transmission.recipientIds.length, 100);
    assert.equal(retry.transmission.audiences[0]!.eligibleCount, 100);
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          body: "@ch:other Forbidden",
          idempotencyKey: "forbidden",
        }),
      errorCode("not_found"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("broadcast snapshot and subscription changes inside a failed recipient write roll back together", async () => {
  const f = fixture();
  try {
    f.store.subscriptions.set(f.workerContext, {
      kind: "listen",
      channelId: f.project.channelId,
    });
    const db = f.bb.storage.database();
    db.exec(
      "CREATE TRIGGER fail_broadcast BEFORE INSERT ON transmission_recipients BEGIN DELETE FROM subscriptions; SELECT RAISE(ABORT, 'recipient failed'); END",
    );
    const request = {
      ...f.input,
      body: "@ch:one Atomic",
      idempotencyKey: "atomic",
    };
    assert.throws(
      () => f.store.transmissions.send(f.context, request),
      /recipient failed/,
    );
    assert.equal(
      f.store.subscriptions.list(f.workerContext, {}).items.length,
      1,
    );
    assert.equal(
      db
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM transmissions")
        .get()!.n,
      1,
    );
    db.exec("DROP TRIGGER fail_broadcast");
    f.store.subscriptions.set(f.workerContext, {
      kind: "unlisten",
      channelId: f.project.channelId,
    });
    const retry = f.store.transmissions.send(f.context, request);
    assert.equal(retry.replayed, false);
    assert.deepEqual(retry.transmission.audiences, [
      { channelId: f.project.channelId, eligibleCount: 0 },
    ]);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
