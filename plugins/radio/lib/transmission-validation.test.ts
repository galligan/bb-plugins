import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TransmissionContext } from "./transmission-contracts.ts";
import {
  transmissionFixture,
  errorCode as code,
} from "./transmission-fixture.ts";

function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  return { ...host, ...transmissionFixture(host.bb) };
}

test("principal scope and author/session ownership cannot be claimed through send input", async () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.store.transmissions.send(
          { ...f.context, authorId: f.target.id },
          f.input,
        ),
      code("forbidden"),
    );
    const foreignSession = f.store.identities.registerThread(
      "thr_foreign",
      f.target.id,
    );
    assert.throws(
      () =>
        f.store.transmissions.send(
          { ...f.context, sessionId: foreignSession.id },
          f.input,
        ),
      code("forbidden"),
    );
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          authorId: f.target.id,
        }),
      code("invalid_input"),
    );
    const first = f.store.identities.registerExternal(
      { principalId: "one" },
      { sessionId: "worker" },
    );
    const second = f.store.identities.registerExternal(
      { principalId: "two" },
      { sessionId: "worker" },
    );
    const external = (
      principalId: string,
      authorId: string,
      sessionId: string,
    ): TransmissionContext => ({
      caller: { kind: "principal", principalId },
      authorId,
      sessionId,
      scope: f.context.scope,
    });
    const sent = f.store.transmissions.send(
      external("one", first.actorId!, first.id),
      f.input,
    );
    assert.throws(
      () =>
        f.store.transmissions.send(
          external("two", first.actorId!, first.id),
          f.input,
        ),
      code("forbidden"),
    );
    const other = f.store.transmissions.send(
      external("two", second.actorId!, second.id),
      f.input,
    );
    assert.notEqual(other.transmission.id, sent.transmission.id);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("reply and reference access is checked, same-channel replies never inherit recipients", async () => {
  const f = fixture();
  try {
    const parent = f.store.transmissions.send(f.context, {
      ...f.input,
      body: "@worker ready",
    }).transmission;
    const reply = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "reply",
      replyToId: parent.id,
    }).transmission;
    assert.equal(reply.replyToId, parent.id);
    assert.deepEqual(reply.recipientIds, []);
    const wide = {
      ...f.context,
      scope: { projectIds: [f.project.id, f.other.id] },
    };
    const privateTx = f.store.transmissions.send(wide, {
      ...f.input,
      channelId: f.other.channelId,
      idempotencyKey: "private",
    }).transmission;
    for (const change of [
      { replyToId: privateTx.id },
      { refs: [{ kind: "transmission", id: privateTx.id }] },
      { refs: [{ kind: "channel", id: f.other.channelId }] },
    ])
      assert.throws(
        () =>
          f.store.transmissions.send(f.context, {
            ...f.input,
            idempotencyKey: "forbidden",
            ...change,
          }),
        code("not_found"),
      );
    assert.throws(
      () =>
        f.store.transmissions.send(wide, {
          ...f.input,
          idempotencyKey: "cross",
          replyToId: privateTx.id,
        }),
      code("invalid_input"),
    );
    assert.throws(
      () => f.store.transmissions.get(parent.id, { projectIds: [] }),
      code("not_found"),
    );
    assert.throws(
      () =>
        f.store.transmissions.send(
          { ...f.context, scope: { projectIds: [] } },
          f.input,
        ),
      code("not_found"),
    );
    const referenced = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "ref",
      refs: [{ kind: "transmission", id: parent.id }],
    });
    assert.deepEqual(referenced.transmission.refs, [
      { kind: "transmission", id: parent.id },
    ]);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("unknown addressing and invalid refs leave no accepted request", async () => {
  const f = fixture();
  try {
    const hidden = f.store.identities.createActor();
    f.store.handles.assign(f.other.id, hidden.id, "private", {
      kind: "human",
      actorId: f.human.id,
    });
    for (const change of [
      { body: "@missing unknown" },
      { body: "@one:worker:" },
      { recipientIds: [hidden.id] },
      { refs: [{ kind: "participant", id: hidden.id }] },
      { refs: [{ kind: "url", url: "javascript:alert(1)" }] },
      { refs: [{ kind: "url", url: "https://user:secret@example.com/" }] },
    ])
      assert.throws(() =>
        f.store.transmissions.send(f.context, { ...f.input, ...change }),
      );
    assert.equal(
      f.bb.storage
        .database()
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM transmissions")
        .get()!.n,
      0,
    );
    const repaired = f.store.transmissions.send(f.context, {
      ...f.input,
      body: '"@missing" `@missing` \\@missing',
    });
    assert.deepEqual(repaired.transmission.recipientIds, []);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("size diagnostics count Unicode characters and never truncate or exempt inline tokens", async () => {
  const f = fixture();
  try {
    assert.equal(
      f.store.transmissions.send(f.context, {
        ...f.input,
        body: "😀".repeat(400),
      }).transmission.body,
      "😀".repeat(400),
    );
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          idempotencyKey: "long",
          body: "😀".repeat(401),
        }),
      /401 characters.*400/,
    );
    for (const body of [" ", "x".repeat(2001), "@worker ".repeat(51)])
      assert.throws(
        () => f.store.transmissions.send(f.context, { ...f.input, body }),
        code("invalid_input"),
      );
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          refs: Array(17).fill({ kind: "url", url: "https://example.com" }),
        }),
      code("invalid_input"),
    );
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          idempotencyKey: "x".repeat(129),
        }),
      code("invalid_input"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("recipient limits count distinct canonical IDs and bound raw duplicate input separately", async () => {
  const f = fixture();
  try {
    const sent = f.store.transmissions.send(f.context, {
      ...f.input,
      recipientIds: Array(101).fill(f.target.id),
    });
    assert.deepEqual(sent.transmission.recipientIds, [f.target.id]);
    assert.equal(
      f.store.transmissions.send(f.context, {
        ...f.input,
        recipientIds: [f.target.id],
      }).transmission.id,
      sent.transmission.id,
    );
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          idempotencyKey: "unique",
          recipientIds: Array.from(
            { length: 101 },
            (_, index) => `actor_${index}`,
          ),
        }),
      /100.*distinct recipients/,
    );
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          recipientIds: Array(1001).fill(f.target.id),
        }),
      code("invalid_input"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
