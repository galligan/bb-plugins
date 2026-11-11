import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { attentionFixture } from "./attention-fixture.ts";
import { errorCode } from "./transmission-fixture.ts";
function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  return { ...host, ...attentionFixture(host.bb) };
}

test("discovery honors exact subscriptions/mute while old required responses and commitments ignore recent cutoffs and squelch", async () => {
  const f = fixture();
  try {
    f.store.subscriptions.set(f.workerContext, {
      channelId: f.project.channelId,
      kind: "listen",
    });
    const passive = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "passive",
    }).transmission;
    const direct = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "direct",
      recipientIds: [f.worker.id],
      requireAck: true,
    }).transmission;
    f.store.transmissions.send(f.workerContext, {
      ...f.input,
      idempotencyKey: "self",
    });
    const initial = f.store.attention.check(f.workerContext, {});
    assert.deepEqual(
      initial.discovery.items.map(({ id }) => id),
      [passive.id, direct.id],
    );
    assert.equal(initial.required.items.length, 1);
    const commitment = f.store.commitments.act(f.workerContext, {
      kind: "wilco",
      txId: passive.id,
      targetId: f.target.id,
      idempotencyKey: "accept",
    }).commitment;
    f.bb.storage
      .database()
      .prepare(
        "UPDATE commitments SET opened_at = '2000-01-01T00:00:00Z' WHERE id = ?",
      )
      .run(commitment.id);
    f.store.subscriptions.set(f.workerContext, {
      channelId: f.project.channelId,
      kind: "mute",
    });
    assert.deepEqual(
      f.store.attention
        .check(f.workerContext, {})
        .discovery.items.map(({ id }) => id),
      [direct.id],
    );
    f.store.responses.record(f.workerContext, {
      txId: direct.id,
      targetId: f.worker.id,
      kind: "squelch",
      idempotencyKey: "dismiss",
    });
    const recent = f.store.attention.check(f.workerContext, {
      since: "2099-01-01T00:00:00Z",
    });
    assert.deepEqual(recent.discovery.items, []);
    assert.equal(recent.required.items[0]!.txId, direct.id);
    assert.equal(recent.commitments.items[0]!.id, commitment.id);
    assert.equal(recent.commitments.items[0]!.openedAt, "2000-01-01T00:00:00Z");
    assert.equal(
      f.store.responses.summary(f.context.scope, direct.id)[0]!
        .receivedEndpoints,
      0,
    );
    assert.equal(
      f.bb.storage
        .database()
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM response_events")
        .get()!.n,
      1,
    );
    assert.deepEqual(recent.pageCounts, {
      discovery: 0,
      required: 1,
      commitments: 1,
    });
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("ack, work acceptance, completion and a substantive reply cover distinct requirements", async () => {
  const f = fixture();
  try {
    const parent = f.store.transmissions.send(f.context, {
      ...f.input,
      requireAck: true,
      expectReply: true,
      recipientIds: [f.target.id],
    }).transmission;
    assert.deepEqual(
      f.store.attention
        .check(f.workerContext, {})
        .required.items.map(({ needAck, needReply }) => ({
          needAck,
          needReply,
        })),
      [{ needAck: true, needReply: true }],
    );
    const opened = f.store.commitments.act(f.workerContext, {
      kind: "wilco",
      txId: parent.id,
      targetId: f.target.id,
      idempotencyKey: "accept",
    }).commitment;
    f.store.commitments.act(f.workerContext, {
      kind: "done",
      commitmentId: opened.id,
      result: "Verified",
      idempotencyKey: "done",
    });
    assert.equal(
      f.store.attention.check(f.workerContext, {}).required.items[0]!.needAck,
      true,
    );
    assert.equal(
      f.store.attention.check(f.workerContext, {}).required.items[0]!.needReply,
      true,
    );
    f.store.responses.record(f.workerContext, {
      kind: "ack",
      txId: parent.id,
      targetId: f.target.id,
      idempotencyKey: "ack",
    });
    const afterAck = f.store.attention.check(f.workerContext, {}).required
      .items[0]!;
    assert.equal(afterAck.needAck, false);
    assert.equal(afterAck.needReply, true);
    const reply = f.store.transmissions.send(f.workerContext, {
      ...f.input,
      body: "Migration verified in staging.",
      replyToId: parent.id,
      idempotencyKey: "reply",
    }).transmission;
    assert.equal(reply.replyForId, f.target.id);
    assert.deepEqual(
      f.store.attention.check(f.workerContext, {}).required.items,
      [],
    );
    // The original author can discover its reply without fabricating a recipient.
    assert.deepEqual(
      f.store.attention
        .check(f.context, {})
        .discovery.items.map(({ id }) => id),
      [reply.id],
    );
    const sibling = f.store.identities.registerThread(
      "thr_senderSibling",
      f.author.id,
    );
    assert.deepEqual(
      f.store.attention.check({ ...f.context, sessionId: sibling.id }, {})
        .discovery.items,
      [],
    );
    assert.deepEqual(reply.recipientIds, []);
    assert.equal(
      f.store.responses.summary(f.context.scope, parent.id)[0]!
        .receivedEndpoints,
      0,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("independent requirement cursors preserve several same-tx targets and old work across bounded pages", async () => {
  const f = fixture();
  try {
    const other = f.store.identities.registerThread(
      "thr_otherWorker",
      f.target.id,
    );
    const parent = f.store.transmissions.send(f.context, {
      ...f.input,
      requireAck: true,
      recipientIds: [f.target.id, f.worker.id, other.id],
    }).transmission;
    for (const targetId of [f.target.id, f.worker.id])
      f.store.commitments.act(f.workerContext, {
        kind: "wilco",
        txId: parent.id,
        targetId,
        idempotencyKey: `accept-${targetId}`,
      });
    const first = f.store.attention.check(f.workerContext, { limit: 1 });
    assert.equal(first.discovery.items.length, 1);
    assert.equal(first.required.hasMore, true);
    assert.equal(first.commitments.hasMore, true);
    const second = f.store.attention.check(f.workerContext, {
      limit: 1,
      requiredAfter: first.required.nextCursor,
      commitmentAfter: first.commitments.nextCursor,
      after: first.discovery.nextCursor,
    });
    assert.equal(second.discovery.items.length, 0);
    assert.equal(second.required.hasMore, true);
    assert.equal(second.commitments.hasMore, false);
    const third = f.store.attention.check(f.workerContext, {
      limit: 1,
      requiredAfter: second.required.nextCursor,
    });
    assert.equal(third.required.hasMore, false);
    assert.deepEqual(
      [first, second, third]
        .map((page) => page.required.items[0]!.targetId)
        .sort(),
      [f.target.id, f.worker.id, other.id].sort(),
    );
    assert.deepEqual(f.store.attention.check(f.context, {}).required.items, []);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("digest validates bounded input and owner/project scope without leaking inaccessible targets", async () => {
  const f = fixture();
  try {
    const wide = {
      ...f.context,
      scope: { projectIds: [f.project.id, f.other.id] },
    };
    const privateTx = f.store.transmissions.send(wide, {
      ...f.input,
      channelId: f.other.channelId,
      requireAck: true,
      recipientIds: [f.target.id],
    }).transmission;
    const restricted = f.store.attention.check(f.workerContext, {});
    assert.deepEqual(restricted.discovery.items, []);
    assert.deepEqual(restricted.required.items, []);
    const allowed = f.store.attention.check(
      { ...f.workerContext, scope: wide.scope },
      {},
    );
    assert.equal(allowed.required.items[0]!.txId, privateTx.id);
    for (const change of [
      { limit: 51 },
      { since: "yesterday" },
      { after: -1 },
      { requiredAfter: { cursor: -1, targetId: "" } },
      { actorId: f.author.id },
    ])
      assert.throws(
        () => f.store.attention.check(f.workerContext, change),
        errorCode("invalid_input"),
      );
    assert.throws(
      () =>
        f.store.attention.check(
          { ...f.workerContext, caller: f.context.caller },
          {},
        ),
      errorCode("forbidden"),
    );
    assert.deepEqual(
      f.store.attention.check(
        { ...f.workerContext, scope: { projectIds: [] } },
        {},
      ).pageCounts,
      { discovery: 0, required: 0, commitments: 0 },
    );
    assert.throws(
      () =>
        f.store.attention.check(
          {
            ...f.workerContext,
            scope: { projectIds: [], currentProjectId: f.project.id },
          },
          {},
        ),
      errorCode("forbidden"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("a sibling session's listener does not override this session's mute or surface its unrelated inbox", async () => {
  const f = fixture();
  try {
    const sibling = f.store.identities.registerThread(
      "thr_sibling",
      f.target.id,
    );
    const siblingContext = { ...f.workerContext, sessionId: sibling.id };
    for (const context of [f.workerContext, siblingContext])
      f.store.subscriptions.set(context, {
        kind: "listen",
        channelId: f.project.channelId,
      });
    f.store.subscriptions.set(f.workerContext, {
      kind: "mute",
      channelId: f.project.channelId,
    });
    const passive = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "passive",
    }).transmission;
    const direct = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "sibling-direct",
      recipientIds: [sibling.id],
      requireAck: true,
    }).transmission;
    assert.deepEqual(
      f.store.attention.check(f.workerContext, {}).discovery.items,
      [],
    );
    assert.deepEqual(
      f.store.attention
        .check(siblingContext, {})
        .discovery.items.map(({ id }) => id),
      [passive.id, direct.id],
    );
    // Durable bot-wide obligations remain visible, labeled by exact target.
    assert.equal(
      f.store.attention.check(f.workerContext, {}).required.items[0]!.targetId,
      sibling.id,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
