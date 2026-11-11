import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { attentionFixture } from "./attention-fixture.ts";
import { errorCode } from "./transmission-fixture.ts";
import { RadioError } from "./errors.ts";
function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  return { ...host, ...attentionFixture(host.bb) };
}

test("mixed actor/session replies require an exact choice and satisfy only one recipient at a time", async () => {
  const f = fixture();
  try {
    const parent = f.store.transmissions.send(f.context, {
      ...f.input,
      recipientIds: [f.target.id, f.worker.id],
      requireAck: true,
      expectReply: true,
    }).transmission;
    const request = {
      ...f.input,
      body: "Verified.",
      replyToId: parent.id,
      idempotencyKey: "reply",
    };
    assert.throws(
      () => f.store.transmissions.send(f.workerContext, request),
      (error) => {
        assert.ok(error instanceof RadioError);
        assert.equal(error.code, "ambiguous");
        assert.deepEqual(
          error.choices.sort(),
          [f.target.id, f.worker.id].sort(),
        );
        return true;
      },
    );
    const actorReply = f.store.transmissions.send(f.workerContext, {
      ...request,
      replyForId: f.target.id,
    }).transmission;
    assert.equal(actorReply.replyForId, f.target.id);
    assert.deepEqual(actorReply.recipientIds, []);
    const first = f.store.attention.check(f.workerContext, {}).required.items;
    assert.equal(
      first.find(({ targetId }) => targetId === f.target.id)!.needReply,
      false,
    );
    assert.equal(
      first.find(({ targetId }) => targetId === f.worker.id)!.needReply,
      true,
    );
    for (const targetId of [f.target.id, f.worker.id])
      f.store.responses.record(f.workerContext, {
        kind: "ack",
        txId: parent.id,
        targetId,
        idempotencyKey: `ack-${targetId}`,
      });
    assert.deepEqual(
      f.store.attention
        .check(f.workerContext, {})
        .required.items.map(({ targetId }) => targetId),
      [f.worker.id],
    );
    const sessionRequest = {
      ...request,
      replyForId: f.worker.id,
      idempotencyKey: "session-reply",
    };
    const sessionReply = f.store.transmissions.send(
      f.workerContext,
      sessionRequest,
    ).transmission;
    assert.equal(sessionReply.replyForId, f.worker.id);
    assert.deepEqual(
      f.store.attention.check(f.workerContext, {}).required.items,
      [],
    );
    assert.deepEqual(
      f.store.transmissions.send(f.workerContext, sessionRequest).transmission,
      sessionReply,
    );
    assert.equal(
      f.store.responses
        .summary(f.context.scope, parent.id)
        .every(({ receivedEndpoints }) => receivedEndpoints === 0),
      true,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("reply coverage cannot be claimed for a foreign or unaddressed target and requires a parent", async () => {
  const f = fixture();
  try {
    const parent = f.store.transmissions.send(f.context, {
      ...f.input,
      recipientIds: [f.worker.id],
      expectReply: true,
    }).transmission;
    const request = {
      ...f.input,
      replyToId: parent.id,
      idempotencyKey: "reply",
    };
    assert.throws(
      () =>
        f.store.transmissions.send(f.workerContext, {
          ...request,
          replyForId: f.author.id,
        }),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.transmissions.send(f.workerContext, {
          ...request,
          replyForId: f.target.id,
        }),
      errorCode("invalid_input"),
    );
    assert.throws(
      () =>
        f.store.transmissions.send(f.workerContext, {
          ...f.input,
          replyForId: f.worker.id,
        }),
      errorCode("invalid_input"),
    );
    const reply = f.store.transmissions.send(
      f.workerContext,
      request,
    ).transmission;
    assert.equal(reply.replyForId, f.worker.id);
    assert.deepEqual(
      f.store.attention.check(f.workerContext, {}).required.items,
      [],
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
