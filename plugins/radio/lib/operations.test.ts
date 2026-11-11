import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { RadioOperations, operationIsRead } from "./operations.ts";
import { attentionFixture } from "./attention-fixture.ts";
import { errorCode } from "./transmission-fixture.ts";
import type { Transmission } from "./transmission-contracts.ts";
import type { DispatchRevision } from "./dispatch-contracts.ts";
import type { CommitmentOutcome } from "./commitment-contracts.ts";

function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  const f = attentionFixture(host.bb);
  const scope = { ...f.context.scope, currentProjectId: f.project.id };
  const context = { ...f.context, scope };
  const worker = { ...f.workerContext, scope };
  const ops = new RadioOperations(host.bb.storage.database(), f.store);
  const call = (op: string, input: unknown, as = context) =>
    ops.execute(as, { op, input });
  return { ...f, ...host, context, workerContext: worker, ops, call };
}

test("shared operations keep normalized handles/channels canonical and page aliases without unrelated project data", async () => {
  const f = fixture();
  try {
    const who = f.call("whoami", {}) as {
      actorId: string;
      sessionId: string;
      project: { id: string };
    };
    assert.equal(who.actorId, f.author.id);
    assert.equal(who.sessionId, f.session.id);
    assert.equal(who.project.id, f.project.id);
    f.call("handle-assign", { name: "Sender__Name" });
    assert.equal(
      f.store.handles.lookup(f.project.id, "sender-name")!.targetId,
      f.session.id,
    );
    f.call("handle-rename", { name: "New--Sender" });
    const handles = f.call("handles", { limit: 1 }) as {
      items: { name: string }[];
      nextCursor: string;
      hasMore: boolean;
    };
    assert.equal(handles.hasMore, true);
    assert.equal(handles.items[0]!.name, "new-sender");
    const next = f.call("handles", {
      after: handles.nextCursor,
    }) as typeof handles;
    assert.deepEqual(
      next.items.map(({ name }) => name),
      ["sender-name", "worker"],
    );
    f.call("alias-remove", { name: "sender-name" });
    assert.equal(f.store.handles.lookup(f.project.id, "sender-name"), null);
    const sub = f.call("channel-create", { name: "Code__Review" }) as {
      channel: { id: string; name: string };
    };
    assert.equal(sub.channel.name, "code-review");
    f.call("channel-rename", { id: sub.channel.id, name: "Ready--Now" });
    assert.equal(f.store.projects.channel(sub.channel.id).name, "ready-now");
    const channels = f.call("channels", {}) as { items: { id: string }[] };
    assert.deepEqual(
      channels.items.map(({ id }) => id).sort(),
      [f.project.channelId, sub.channel.id].sort(),
    );
    assert.throws(
      () => f.call("channel-rename", { id: f.other.channelId, name: "stolen" }),
      errorCode("not_found"),
    );
    assert.throws(
      () =>
        f.call("handle-reclaim", { name: "worker", targetId: f.session.id }),
      errorCode("forbidden"),
    );
    assert.throws(
      () => f.call("handle-rename", { name: "stolen", targetId: f.target.id }),
      errorCode("forbidden"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("readable posting paths replay before rename/reallocation while changed input and lost access fail", async () => {
  const f = fixture();
  try {
    const input = { ch: "one", body: "Ready", idempotencyKey: "path" };
    const first = f.call("tx", input) as {
      transmission: Transmission;
      replayed: boolean;
    };
    f.call("project-rename", { name: "Renamed__Project" });
    const reused = f.store.projects.register("proj_reused", "one").project;
    const replay = f.call("tx", input) as typeof first;
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.transmission, first.transmission);
    assert.notEqual(replay.transmission.channelId, reused.channelId);
    assert.throws(
      () => f.call("tx", { ...input, body: "Changed" }),
      errorCode("conflict"),
    );
    const invalidContext = {
      ...f.context,
      scope: { projectIds: [reused.id], currentProjectId: reused.id },
    };
    assert.throws(
      () => f.call("tx", input, invalidContext),
      errorCode("not_found"),
    );
    assert.throws(
      () => f.call("tx", { ...input, channelId: f.project.channelId }),
      errorCode("invalid_input"),
    );
    assert.throws(
      () =>
        f.call("reply", {
          ...input,
          ch: "renamed-project",
          idempotencyKey: "no-parent",
        }),
      errorCode("invalid_input"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("shared protocol/dispatch/subscription operations preserve explicit receipt and one-target reply semantics", async () => {
  const f = fixture();
  try {
    f.call(
      "subscribe",
      { kind: "listen", channelId: f.project.channelId },
      f.workerContext,
    );
    assert.equal(
      (f.call("listening", {}, f.workerContext) as { items: unknown[] }).items
        .length,
      1,
    );
    const created = f.call("dispatch-create", {
      channelId: f.project.channelId,
      idempotencyKey: "doc",
      title: "Plan",
      markdown: "Details",
    }) as { dispatch: DispatchRevision };
    const dispatch = created.dispatch;
    f.call("dispatch-revise", {
      id: dispatch.id,
      expectedRevision: 1,
      idempotencyKey: "revision",
      title: "Plan",
      markdown: "Revised details",
    });
    assert.equal(
      (f.call("dispatch-read", { id: dispatch.id }) as DispatchRevision)
        .revision,
      2,
    );
    assert.equal(
      (
        f.call("dispatch-list", { channelId: f.project.channelId }) as {
          items: unknown[];
        }
      ).items.length,
      1,
    );
    const sent = f.call("tx", {
      ...f.input,
      body: "@ch:one Confirm the plan",
      requireAck: true,
      expectReply: true,
      refs: [{ kind: "dispatch", id: dispatch.id }],
    }) as { transmission: Transmission };
    assert.deepEqual(sent.transmission.recipientIds, [f.worker.id]);
    const txId = sent.transmission.id;
    f.call(
      "respond",
      { kind: "standby", txId, targetId: f.worker.id, idempotencyKey: "wait" },
      f.workerContext,
    );
    assert.equal(
      (f.call("commitments", {}, f.workerContext) as { items: unknown[] }).items
        .length,
      0,
    );
    const accepted = f.call(
      "commit",
      { kind: "wilco", txId, targetId: f.worker.id, idempotencyKey: "accept" },
      f.workerContext,
    ) as CommitmentOutcome;
    f.call(
      "commit",
      {
        kind: "done",
        commitmentId: accepted.commitment.id,
        result: "Verified",
        idempotencyKey: "done",
      },
      f.workerContext,
    );
    assert.equal(
      (
        f.call(
          "commitment",
          { id: accepted.commitment.id },
          f.workerContext,
        ) as CommitmentOutcome["commitment"]
      ).status,
      "done",
    );
    assert.equal(
      (
        f.call("commitment-events", { txId }, f.workerContext) as {
          items: unknown[];
        }
      ).items.length,
      2,
    );
    assert.equal(
      (f.call("commitments", {}, f.workerContext) as { items: unknown[] }).items
        .length,
      0,
    );
    f.call(
      "reply",
      {
        ...f.input,
        body: "Plan verified",
        replyToId: txId,
        idempotencyKey: "reply",
      },
      f.workerContext,
    );
    const need = f.call("check", {}, f.workerContext) as {
      required: { items: { needAck: boolean; needReply: boolean }[] };
    };
    assert.equal(need.required.items[0]!.needReply, false);
    assert.equal(need.required.items[0]!.needAck, true);
    f.call(
      "respond",
      { kind: "ack", txId, targetId: f.worker.id, idempotencyKey: "ack" },
      f.workerContext,
    );
    assert.equal(
      f.store.responses.summary(f.context.scope, txId)[0]!.receivedEndpoints,
      0,
    );
    f.call(
      "respond",
      {
        kind: "received",
        txId,
        targetId: f.worker.id,
        idempotencyKey: "received",
      },
      f.workerContext,
    );
    assert.equal(
      f.store.responses.summary(f.context.scope, txId)[0]!.receivedEndpoints,
      1,
    );
    assert.equal(
      (f.call("check", {}, f.workerContext) as typeof need).required.items
        .length,
      0,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("bounded hints and discovery/history reads never record received or waive obligations", async () => {
  const f = fixture();
  try {
    const sent = f.call("tx", {
      ...f.input,
      requireAck: true,
      recipientIds: [f.worker.id],
    }) as { transmission: Transmission };
    const db = f.bb.storage.database();
    for (const [op, input] of [
      ["check", {}],
      ["scan", { channelId: f.project.channelId }],
      ["read", { id: sent.transmission.id }],
      ["responses", { txId: sent.transmission.id }],
      ["response-summary", { txId: sent.transmission.id }],
    ] as const) {
      f.call(op, input, f.workerContext);
      assert.equal(operationIsRead(op), true);
    }
    const hint = f.ops.hint(f.workerContext);
    assert.deepEqual(hint.required, { sampleCount: 1, hasMore: false });
    assert.equal(
      db
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM response_events")
        .get()!.n,
      0,
    );
    assert.equal(
      f.store.responses.summary(f.context.scope, sent.transmission.id)[0]!
        .receivedEndpoints,
      0,
    );
    for (const request of [
      { op: "no-such-command", input: {} },
      { op: "whoami", input: { authorId: f.target.id } },
      { op: "check", input: { limit: 51 } },
      { op: "scan", input: { channelId: f.project.channelId, limit: 0 } },
      { op: "whoami", input: {}, operatorCredential: "claimed" },
    ])
      assert.throws(
        () => f.ops.execute(f.context, request),
        errorCode("invalid_input"),
      );
    const abort = new AbortController();
    abort.abort();
    assert.throws(
      () =>
        f.ops.execute(
          f.context,
          { op: "tx", input: { ...f.input, idempotencyKey: "cancelled" } },
          abort.signal,
        ),
      { name: "AbortError" },
    );
    assert.equal(
      f.store.transmissions.scan(f.context.scope, {
        channelId: f.project.channelId,
      }).items.length,
      1,
    );
    assert.throws(
      () =>
        f.ops.execute(
          { ...f.context, caller: f.workerContext.caller },
          { op: "whoami", input: {} },
        ),
      errorCode("forbidden"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
