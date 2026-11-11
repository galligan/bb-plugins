import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { commitmentFixture } from "./commitment-fixture.ts";
import { errorCode } from "./transmission-fixture.ts";
import { openRadioStorage } from "./storage.ts";
function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  return { ...host, ...commitmentFixture(host.bb) };
}

test("subscriptions default to invoking session, remain canonical through rename/reopen and mutate idempotently", async () => {
  const f = fixture();
  try {
    const request = { channelId: f.project.channelId, kind: "listen" };
    const first = f.store.subscriptions.set(f.workerContext, request);
    assert.equal(first.subscription!.targetId, f.worker.id);
    assert.deepEqual(
      f.store.subscriptions.set(f.workerContext, request),
      first,
    );
    assert.equal(
      f.store.subscriptions.list(f.workerContext, {}).items.length,
      1,
    );
    assert.equal(
      f.store.subscriptions.list(f.workerContext, { targetId: f.target.id })
        .items.length,
      0,
    );
    const mute = { ...request, kind: "mute" };
    assert.equal(
      f.store.subscriptions.set(f.workerContext, mute).subscription!.muted,
      true,
    );
    assert.equal(
      f.store.subscriptions.set(f.workerContext, mute).subscription!.muted,
      true,
    );
    f.store.projects.rename(f.project.id, "renamed");
    f.bb.storage.database().close();
    const reopened = openRadioStorage(f.bb.storage);
    assert.equal(
      reopened.subscriptions.list(f.workerContext, {}).items[0]!.channelId,
      f.project.channelId,
    );
    assert.deepEqual(
      reopened.subscriptions.set(f.workerContext, request),
      first,
    );
    const unlisten = { ...request, kind: "unlisten" };
    const removed = reopened.subscriptions.set(f.workerContext, unlisten);
    assert.deepEqual(
      reopened.subscriptions.set(f.workerContext, unlisten),
      removed,
    );
    assert.deepEqual(
      reopened.subscriptions.list(f.workerContext, {}).items,
      [],
    );
    assert.throws(
      () => reopened.subscriptions.set(f.workerContext, mute),
      errorCode("not_found"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("subscription ownership/project access is explicit and owners can withdraw after access loss", async () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.store.subscriptions.set(f.context, {
          kind: "listen",
          channelId: f.project.channelId,
          targetId: f.target.id,
        }),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.subscriptions.set(f.workerContext, {
          kind: "listen",
          channelId: f.other.channelId,
        }),
      errorCode("not_found"),
    );
    assert.throws(
      () =>
        f.store.subscriptions.list(f.workerContext, {
          channelId: f.other.channelId,
          limit: 1,
        }),
      errorCode("not_found"),
    );
    assert.deepEqual(
      f.store.subscriptions.list(f.workerContext, {
        channelId: f.project.channelId,
        limit: 1,
      }).items,
      [],
    );
    const otherSession = f.store.identities.registerThread(
      "thr_otherWorker",
      f.target.id,
    );
    assert.throws(
      () =>
        f.store.subscriptions.set(f.workerContext, {
          kind: "listen",
          channelId: f.project.channelId,
          targetId: otherSession.id,
        }),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.subscriptions.list(f.workerContext, {
          targetId: otherSession.id,
        }),
      errorCode("forbidden"),
    );
    f.store.subscriptions.set(f.workerContext, {
      kind: "listen",
      channelId: f.project.channelId,
    });
    const revoked = { ...f.workerContext, scope: { projectIds: [] } };
    assert.deepEqual(f.store.subscriptions.list(revoked, {}).items, []);
    assert.equal(
      f.store.subscriptions.set(revoked, {
        kind: "mute",
        channelId: f.project.channelId,
      }).subscription!.muted,
      true,
    );
    assert.equal(
      f.store.subscriptions.set(revoked, {
        kind: "unlisten",
        channelId: f.project.channelId,
      }).state,
      "unlistening",
    );
    assert.throws(
      () =>
        f.store.subscriptions.set(revoked, {
          kind: "listen",
          channelId: f.project.channelId,
        }),
      errorCode("not_found"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("bounded listening lists paginate only accessible channels for the exact selected target", async () => {
  const f = fixture();
  try {
    const sub = f.store.projects.addSubchannel(
      f.project.id,
      "Cut__Over",
    ).channel;
    for (const channelId of [f.project.channelId, sub.id])
      f.store.subscriptions.set(f.workerContext, { kind: "listen", channelId });
    const page = f.store.subscriptions.list(f.workerContext, { limit: 1 });
    assert.equal(page.items.length, 1);
    assert.equal(page.hasMore, true);
    const last = f.store.subscriptions.list(f.workerContext, {
      after: page.nextCursor,
      limit: 1,
    });
    assert.equal(last.items.length, 1);
    assert.equal(last.hasMore, false);
    assert.notEqual(page.items[0]!.channelId, last.items[0]!.channelId);
    f.store.projects.renameChannel(sub.id, "new-name");
    assert.equal(
      f.store.subscriptions.list(f.workerContext, { after: page.nextCursor })
        .items[0]!.channelId,
      sub.id,
    );
    assert.throws(
      () => f.store.subscriptions.list(f.workerContext, { limit: 51 }),
      errorCode("invalid_input"),
    );
    assert.throws(
      () => f.store.subscriptions.list(f.workerContext, { after: -1 }),
      errorCode("invalid_input"),
    );
    assert.throws(
      () =>
        f.store.subscriptions.set(f.workerContext, {
          kind: "listen",
          channelId: sub.id,
          owner: f.target.id,
        }),
      errorCode("invalid_input"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
