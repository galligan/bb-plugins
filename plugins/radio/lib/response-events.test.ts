import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { transmissionFixture, errorCode } from "./transmission-fixture.ts";
import { openRadioStorage } from "./storage.ts";

function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  const f = { ...host, ...transmissionFixture(host.bb) };
  const recipient = f.store.identities.registerThread(
    "thr_recipient",
    f.target.id,
  );
  const tx = f.store.transmissions.send(f.context, {
    ...f.input,
    body: "@worker Please confirm.",
    recipientIds: [recipient.id],
  }).transmission;
  const recipientContext = {
    ...f.context,
    authorId: f.target.id,
    sessionId: recipient.id,
    caller: { kind: "actor" as const, actorId: f.target.id },
  };
  const request = {
    txId: tx.id,
    targetId: f.target.id,
    kind: "received" as const,
    idempotencyKey: "confirm",
  };
  return { ...f, recipient, tx, recipientContext, request };
}

test("acceptance, history, count summaries and ack never invent receipt evidence", async () => {
  const f = fixture();
  try {
    f.store.transmissions.get(f.tx.id, f.context.scope);
    f.store.transmissions.scan(f.context.scope, {
      channelId: f.project.channelId,
    });
    assert.deepEqual(
      f.store.responses.list(f.context.scope, { txId: f.tx.id }).items,
      [],
    );
    const initial = f.store.responses.summary(f.context.scope, f.tx.id);
    assert.equal(
      initial.every(
        ({ receivedEndpoints, ackAt }) =>
          receivedEndpoints === 0 && ackAt === null,
      ),
      true,
    );
    const ack = f.store.responses.record(f.recipientContext, {
      ...f.request,
      kind: "ack",
      idempotencyKey: "ack",
    });
    assert.equal(ack.event.kind, "ack");
    assert.equal(ack.event.payload.evidence, undefined);
    const after = f.store.responses.summary(f.context.scope, f.tx.id);
    assert.equal(
      after.find(({ targetId }) => targetId === f.target.id)!.ackAt,
      ack.event.createdAt,
    );
    assert.equal(
      after.every(({ receivedEndpoints }) => receivedEndpoints === 0),
      true,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("explicit confirmations retain per-session evidence and replay without count inflation", async () => {
  const f = fixture();
  try {
    const first = f.store.responses.record(f.recipientContext, f.request);
    assert.equal(first.replayed, false);
    assert.deepEqual(first.event.payload, {
      endpointId: f.recipient.id,
      evidence: "recipient-confirmation",
    });
    assert.deepEqual(f.store.responses.record(f.recipientContext, f.request), {
      replayed: true,
      event: first.event,
    });
    assert.deepEqual(
      f.store.responses.record(f.recipientContext, {
        ...f.request,
        idempotencyKey: "again",
      }),
      { replayed: true, event: first.event },
    );
    const secondSession = f.store.identities.registerThread(
      "thr_secondRecipient",
      f.target.id,
    );
    f.store.responses.record(
      { ...f.recipientContext, sessionId: secondSession.id },
      { ...f.request, idempotencyKey: "another-session" },
    );
    const summary = f.store.responses.summary(f.context.scope, f.tx.id);
    assert.equal(
      summary.find(({ targetId }) => targetId === f.target.id)!
        .receivedEndpoints,
      2,
    );
    assert.equal(
      summary.find(({ targetId }) => targetId === f.recipient.id)!
        .receivedEndpoints,
      0,
    );
    assert.throws(
      () =>
        f.store.responses.record(f.recipientContext, {
          ...f.request,
          kind: "ack",
        }),
      errorCode("conflict"),
    );
    assert.throws(
      () =>
        f.store.responses.record(
          { ...f.recipientContext, sessionId: undefined },
          { ...f.request, idempotencyKey: "no-endpoint" },
        ),
      errorCode("invalid_input"),
    );
    assert.equal(
      f.store.responses
        .summary(f.context.scope, f.tx.id)
        .every(({ ackAt }) => ackAt === null),
      true,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("mixed actor/session targets have independent facts and exact-session ownership", async () => {
  const f = fixture();
  try {
    f.store.responses.record(f.recipientContext, {
      ...f.request,
      kind: "ack",
      idempotencyKey: "actor-ack",
    });
    assert.equal(
      f.store.responses
        .summary(f.context.scope, f.tx.id)
        .find(({ targetId }) => targetId === f.recipient.id)!.ackAt,
      null,
    );
    const sessionAck = f.store.responses.record(f.recipientContext, {
      ...f.request,
      kind: "ack",
      targetId: f.recipient.id,
      idempotencyKey: "session-ack",
    });
    assert.equal(sessionAck.event.sessionId, f.recipient.id);
    const otherSession = f.store.identities.registerThread(
      "thr_otherRecipient",
      f.target.id,
    );
    assert.throws(
      () =>
        f.store.responses.record(
          { ...f.recipientContext, sessionId: otherSession.id },
          {
            ...f.request,
            targetId: f.recipient.id,
            idempotencyKey: "wrong-session",
          },
        ),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.responses.record(f.context, {
          ...f.request,
          idempotencyKey: "other-actor",
        }),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.responses.record(
          { ...f.context, authorId: f.target.id },
          f.request,
        ),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.responses.record(f.recipientContext, {
          ...f.request,
          evidence: "server-accepted",
        }),
      errorCode("invalid_input"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("standby records waiting and squelch records dismissal without ack, receipt or commitment", async () => {
  const f = fixture();
  try {
    const standby = f.store.responses.record(f.recipientContext, {
      ...f.request,
      kind: "standby",
      reason: "Waiting for credentials",
      idempotencyKey: "wait",
    });
    assert.deepEqual(standby.event.payload, {
      reason: "Waiting for credentials",
    });
    const squelch = f.store.responses.record(f.recipientContext, {
      ...f.request,
      kind: "squelch",
      idempotencyKey: "dismiss",
    });
    assert.equal(squelch.event.kind, "squelch");
    const state = f.store.responses
      .summary(f.context.scope, f.tx.id)
      .find(({ targetId }) => targetId === f.target.id)!;
    assert.equal(state.ackAt, null);
    assert.equal(state.receivedEndpoints, 0);
    assert.equal(state.standbyAt, standby.event.createdAt);
    assert.equal(state.squelchAt, squelch.event.createdAt);
    assert.throws(
      () =>
        f.store.responses.record(f.recipientContext, {
          ...f.request,
          kind: "wilco",
        }),
      errorCode("invalid_input"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("receipt records survive reopen; history is bounded, authorized and nonconfirming", async () => {
  const f = fixture();
  try {
    const first = f.store.responses.record(f.recipientContext, f.request).event;
    f.store.responses.record(f.recipientContext, {
      ...f.request,
      kind: "ack",
      idempotencyKey: "ack",
    });
    f.bb.storage.database().close();
    const reopened = openRadioStorage(f.bb.storage);
    assert.deepEqual(
      reopened.responses.record(f.recipientContext, f.request).event,
      first,
    );
    const page = reopened.responses.list(f.context.scope, {
      txId: f.tx.id,
      limit: 1,
    });
    assert.deepEqual(page.items, [first]);
    assert.equal(page.hasMore, true);
    const next = reopened.responses.list(f.context.scope, {
      txId: f.tx.id,
      after: page.nextCursor,
      limit: 1,
    });
    assert.equal(next.items[0]!.kind, "ack");
    assert.equal(next.hasMore, false);
    assert.throws(
      () => reopened.responses.list({ projectIds: [] }, { txId: f.tx.id }),
      errorCode("not_found"),
    );
    assert.throws(
      () => reopened.responses.summary({ projectIds: [] }, f.tx.id),
      errorCode("not_found"),
    );
    assert.throws(
      () =>
        reopened.responses.record(
          { ...f.recipientContext, scope: { projectIds: [] } },
          f.request,
        ),
      errorCode("not_found"),
    );
    assert.throws(
      () =>
        reopened.responses.list(f.context.scope, { txId: f.tx.id, limit: 51 }),
      errorCode("invalid_input"),
    );
    assert.equal(
      reopened.responses
        .summary(f.context.scope, f.tx.id)
        .find(({ targetId }) => targetId === f.target.id)!.receivedEndpoints,
      1,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("human confirmations use the human endpoint without marking a bot received", async () => {
  const f = fixture();
  try {
    const context = {
      ...f.context,
      caller: { kind: "human" as const, actorId: f.human.id },
      authorId: f.human.id,
      sessionId: undefined,
    };
    const event = f.store.responses.record(context, {
      ...f.request,
      targetId: f.human.id,
    }).event;
    assert.equal(event.payload.endpointId, f.human.id);
    assert.equal(
      f.store.responses
        .summary(f.context.scope, f.tx.id)
        .every(({ receivedEndpoints }) => receivedEndpoints === 0),
      true,
    );
    assert.deepEqual(
      f.store.transmissions.get(f.tx.id, f.context.scope).recipientIds,
      f.tx.recipientIds,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("confirmation/event/request failure rolls back all evidence and retry works", async () => {
  const f = fixture();
  try {
    const db = f.bb.storage.database();
    db.exec(
      "CREATE TRIGGER fail_protocol BEFORE INSERT ON protocol_requests BEGIN SELECT RAISE(ABORT, 'request failed'); END",
    );
    assert.throws(
      () => f.store.responses.record(f.recipientContext, f.request),
      /request failed/,
    );
    assert.deepEqual(
      f.store.responses.list(f.context.scope, { txId: f.tx.id }).items,
      [],
    );
    assert.equal(
      db
        .prepare<[], { n: number }>(
          "SELECT count(*) AS n FROM receipt_confirmations",
        )
        .get()!.n,
      0,
    );
    db.exec("DROP TRIGGER fail_protocol");
    assert.equal(
      f.store.responses.record(f.recipientContext, f.request).replayed,
      false,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
