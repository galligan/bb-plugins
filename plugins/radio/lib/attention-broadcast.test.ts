import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { attentionFixture } from "./attention-fixture.ts";

test("muting broadcast discovery preserves direct overlap, frozen audiences and obligations", async () => {
  const host = createFakePluginHost({ pluginId: "radio" });
  const f = attentionFixture(host.bb);
  try {
    const sub = f.store.projects.addSubchannel(f.project.id, "sub").channel;
    f.store.subscriptions.set(f.workerContext, {
      kind: "listen",
      channelId: sub.id,
    });
    const send = (body: string, key: string, recipientIds: string[] = []) =>
      f.store.transmissions.send(f.context, {
        ...f.input,
        body,
        idempotencyKey: key,
        recipientIds,
        requireAck: true,
        expectReply: true,
      }).transmission;
    // Broadcast targets need not listen to the posting channel.
    const broadcast = send("@ch:one/sub Waiting for confirmation", "broadcast");
    const explicit = send("@ch:one/sub Direct overlap", "explicit", [
      f.worker.id,
    ]);
    f.store.handles.assign(f.project.id, f.worker.id, "worker-session", {
      kind: "actor",
      actorId: f.target.id,
    });
    const mention = send(
      "@ch:one/sub @worker-session Mention overlap",
      "mention",
    );
    const ids = () =>
      f.store.attention
        .check(f.workerContext, {})
        .discovery.items.map(({ id }) => id);
    assert.deepEqual(ids(), [broadcast.id, explicit.id, mention.id]);
    const original = f.store.transmissions.get(broadcast.id, f.context.scope);
    for (const kind of ["mute", "unlisten"] as const) {
      f.store.subscriptions.set(f.workerContext, { kind, channelId: sub.id });
      assert.deepEqual(ids(), [explicit.id, mention.id]);
      assert.deepEqual(
        f.store.transmissions.get(broadcast.id, f.context.scope),
        original,
      );
      assert.deepEqual(
        f.store.attention
          .check(f.workerContext, {})
          .required.items.map(({ txId }) => txId),
        [broadcast.id, explicit.id, mention.id],
      );
      assert.equal(
        f.store.responses.summary(f.context.scope, broadcast.id)[0]!
          .receivedEndpoints,
        0,
      );
    }
    f.store.subscriptions.set(f.workerContext, {
      kind: "listen",
      channelId: sub.id,
    });
    assert.deepEqual(ids(), [broadcast.id, explicit.id, mention.id]);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
