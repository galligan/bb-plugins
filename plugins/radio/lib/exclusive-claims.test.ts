import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { commitmentFixture } from "./commitment-fixture.ts";
import { errorCode } from "./transmission-fixture.ts";
function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  return { ...host, ...commitmentFixture(host.bb) };
}

test("abandon stays closed until original author explicitly reopens; old commitment/event history stays intact", async () => {
  const f = fixture();
  try {
    const tx = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "exclusive",
      requestMode: "exclusive",
    }).transmission;
    const request = { ...f.wilco, txId: tx.id };
    const first = f.store.commitments.act(f.workerContext, request).commitment;
    assert.equal(
      f.store.commitments.act(f.workerContext, {
        ...request,
        idempotencyKey: "again",
      }).commitment.id,
      first.id,
    );
    assert.throws(
      () =>
        f.store.commitments.act(f.context, {
          ...request,
          targetId: f.author.id,
        }),
      errorCode("conflict"),
    );
    const abandon = {
      kind: "abandon",
      commitmentId: first.id,
      reason: "Unavailable until tomorrow",
      idempotencyKey: "abandon",
    };
    const abandoned = f.store.commitments.act(f.workerContext, abandon);
    assert.equal(abandoned.commitment.status, "abandoned");
    assert.throws(
      () =>
        f.store.commitments.act(f.context, {
          ...request,
          targetId: f.author.id,
        }),
      errorCode("conflict"),
    );
    const reopen = {
      kind: "reopen",
      txId: tx.id,
      expectedCommitmentId: first.id,
      idempotencyKey: "reopen",
    };
    assert.throws(
      () => f.store.commitments.act(f.workerContext, reopen),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.commitments.act(f.context, {
          ...reopen,
          expectedCommitmentId: "commitment_wrong",
        }),
      errorCode("conflict"),
    );
    const reopened = f.store.commitments.act(f.context, reopen);
    assert.equal(reopened.event.payload.generation, 2);
    const next = f.store.commitments.act(f.context, {
      ...request,
      targetId: f.author.id,
    }).commitment;
    assert.equal(next.generation, 2);
    assert.notEqual(next.id, first.id);
    assert.deepEqual(f.store.commitments.act(f.workerContext, abandon), {
      ...abandoned,
      replayed: true,
    });
    assert.deepEqual(f.store.commitments.act(f.context, reopen), {
      ...reopened,
      replayed: true,
    });
    assert.equal(
      f.store.commitments.get(f.context.scope, first.id).status,
      "abandoned",
    );
    assert.deepEqual(
      f.store.transmissions.get(tx.id, f.context.scope).recipientIds,
      [],
    );
    const history = f.store.commitments.events(f.context.scope, {
      txId: tx.id,
      limit: 2,
    });
    assert.deepEqual(
      history.items.map(({ kind }) => kind),
      ["wilco", "abandon"],
    );
    assert.equal(history.hasMore, true);
    const later = f.store.commitments.events(f.context.scope, {
      txId: tx.id,
      after: history.nextCursor,
    });
    assert.deepEqual(
      later.items.map(({ kind }) => kind),
      ["reopen", "wilco"],
    );
    assert.throws(
      () => f.store.commitments.events({ projectIds: [] }, { txId: tx.id }),
      errorCode("not_found"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("assigned exclusive requests require exact frozen target and completion cannot reopen", async () => {
  const f = fixture();
  try {
    const tx = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "assigned",
      requestMode: "exclusive",
      recipientIds: [f.target.id],
    }).transmission;
    const request = { ...f.wilco, txId: tx.id };
    assert.throws(
      () =>
        f.store.commitments.act(f.context, {
          ...request,
          targetId: f.author.id,
        }),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.commitments.act(f.workerContext, {
          ...request,
          targetId: f.worker.id,
        }),
      errorCode("forbidden"),
    );
    const opened = f.store.commitments.act(f.workerContext, request).commitment;
    f.store.commitments.act(f.workerContext, {
      kind: "done",
      commitmentId: opened.id,
      result: "Complete",
      idempotencyKey: "done",
    });
    assert.throws(
      () =>
        f.store.commitments.act(f.context, {
          kind: "reopen",
          txId: tx.id,
          expectedCommitmentId: opened.id,
          idempotencyKey: "reopen",
        }),
      errorCode("conflict"),
    );
    assert.throws(
      () =>
        f.store.commitments.act(f.workerContext, {
          ...request,
          idempotencyKey: "after-done",
        }),
      errorCode("conflict"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("failed reopen request cannot release ownership or advance claim generation", async () => {
  const f = fixture();
  try {
    const tx = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "exclusive",
      requestMode: "exclusive",
    }).transmission;
    const opened = f.store.commitments.act(f.workerContext, {
      ...f.wilco,
      txId: tx.id,
    }).commitment;
    f.store.commitments.act(f.workerContext, {
      kind: "abandon",
      commitmentId: opened.id,
      reason: "Cannot proceed",
      idempotencyKey: "abandon",
    });
    const db = f.bb.storage.database();
    db.exec(
      "CREATE TRIGGER fail_reopen BEFORE INSERT ON commitment_requests BEGIN SELECT RAISE(ABORT, 'request failed'); END",
    );
    const reopen = {
      kind: "reopen",
      txId: tx.id,
      expectedCommitmentId: opened.id,
      idempotencyKey: "reopen",
    };
    assert.throws(
      () => f.store.commitments.act(f.context, reopen),
      /request failed/,
    );
    assert.deepEqual(
      db
        .prepare<[string], { generation: number; id: string }>(
          "SELECT generation, commitment_id AS id FROM exclusive_claims WHERE tx_id = ?",
        )
        .get(tx.id),
      { generation: 1, id: opened.id },
    );
    db.exec("DROP TRIGGER fail_reopen");
    assert.equal(
      f.store.commitments.act(f.context, reopen).event.payload.generation,
      2,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
