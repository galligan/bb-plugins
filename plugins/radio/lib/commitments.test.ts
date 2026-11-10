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

test("ordinary discussion supports independent durable commitments without implied ack or receipt", async () => {
  const f = fixture();
  try {
    const first = f.store.commitments.act(f.workerContext, f.wilco);
    const second = f.store.commitments.act(f.context, {
      ...f.wilco,
      targetId: f.author.id,
    });
    assert.notEqual(first.commitment.id, second.commitment.id);
    assert.equal(first.commitment.status, "open");
    assert.equal(first.commitment.openingSessionId, f.worker.id);
    assert.equal(
      f.store.responses
        .summary(f.context.scope, f.tx.id)
        .every(
          ({ ackAt, receivedEndpoints }) =>
            ackAt === null && receivedEndpoints === 0,
        ),
      true,
    );
    f.store.responses.record(f.workerContext, {
      txId: f.tx.id,
      targetId: f.target.id,
      kind: "standby",
      idempotencyKey: "wait",
    });
    f.store.responses.record(f.workerContext, {
      txId: f.tx.id,
      targetId: f.target.id,
      kind: "squelch",
      idempotencyKey: "dismiss",
    });
    f.bb.storage.database().close();
    const reopened = openRadioStorage(f.bb.storage);
    assert.deepEqual(
      reopened.commitments.get(f.context.scope, first.commitment.id),
      first.commitment,
    );
    assert.deepEqual(
      reopened.commitments.act(f.workerContext, f.wilco).commitment,
      first.commitment,
    );
    assert.equal(
      reopened.commitments.list(f.workerContext, {}).items.length,
      1,
    );
    const newSession = reopened.identities.registerThread(
      "thr_newWorker",
      f.target.id,
    );
    const done = reopened.commitments.act(
      { ...f.workerContext, sessionId: newSession.id },
      {
        kind: "done",
        commitmentId: first.commitment.id,
        result: "Migration verified.",
        idempotencyKey: "done",
      },
    );
    assert.equal(done.commitment.status, "done");
    assert.equal(done.event.sessionId, newSession.id);
    assert.equal(done.commitment.result, "Migration verified.");
    assert.equal(
      reopened.commitments.list(f.workerContext, {}).items.length,
      0,
    );
    assert.equal(
      reopened.commitments.list(f.workerContext, { status: "all" }).items
        .length,
      1,
    );
    assert.equal(
      reopened.responses.summary(f.context.scope, f.tx.id)[0]!.ackAt,
      null,
    );
    // Exact replay is the original accepted operation snapshot, even after closure.
    assert.deepEqual(reopened.commitments.act(f.workerContext, f.wilco), {
      replayed: true,
      commitment: first.commitment,
      event: first.event,
    });
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("session obligations require that exact acting session and unrelated actors cannot close them", async () => {
  const f = fixture();
  try {
    const accepted = f.store.commitments.act(f.workerContext, {
      ...f.wilco,
      targetId: f.worker.id,
    });
    const close = {
      kind: "done",
      commitmentId: accepted.commitment.id,
      result: "Verified",
      idempotencyKey: "done",
    };
    assert.throws(
      () => f.store.commitments.act(f.context, close),
      errorCode("forbidden"),
    );
    const next = f.store.identities.registerThread(
      "thr_newWorker",
      f.target.id,
    );
    assert.throws(
      () =>
        f.store.commitments.act(
          { ...f.workerContext, sessionId: next.id },
          close,
        ),
      errorCode("forbidden"),
    );
    assert.throws(
      () => f.store.commitments.act(f.workerContext, { ...close, result: " " }),
      errorCode("invalid_input"),
    );
    assert.throws(
      () =>
        f.store.commitments.act(f.workerContext, {
          kind: "abandon",
          commitmentId: accepted.commitment.id,
          reason: "",
          idempotencyKey: "abandon",
        }),
      errorCode("invalid_input"),
    );
    const closed = f.store.commitments.act(f.workerContext, close);
    assert.equal(closed.commitment.targetId, f.worker.id);
    assert.deepEqual(f.store.commitments.act(f.workerContext, close), {
      ...closed,
      replayed: true,
    });
    assert.throws(
      () =>
        f.store.commitments.act(f.workerContext, {
          ...close,
          result: "Different",
        }),
      errorCode("conflict"),
    );
    assert.throws(
      () =>
        f.store.commitments.act(f.workerContext, {
          ...close,
          idempotencyKey: "again",
        }),
      errorCode("conflict"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("open commitment paging never applies recent-message filters and remains owner/project scoped", async () => {
  const f = fixture();
  try {
    const accepted = f.store.commitments.act(
      f.workerContext,
      f.wilco,
    ).commitment;
    f.bb.storage
      .database()
      .prepare(
        "UPDATE commitments SET opened_at = '2000-01-01T00:00:00Z' WHERE id = ?",
      )
      .run(accepted.id);
    const another = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "second",
    }).transmission;
    f.store.commitments.act(f.workerContext, {
      ...f.wilco,
      txId: another.id,
      idempotencyKey: "second",
    });
    const page = f.store.commitments.list(f.workerContext, { limit: 1 });
    assert.equal(page.items[0]!.id, accepted.id);
    assert.equal(page.items[0]!.openedAt, "2000-01-01T00:00:00Z");
    assert.equal(page.hasMore, true);
    assert.equal(
      f.store.commitments.list(f.workerContext, {
        after: page.nextCursor,
        limit: 1,
      }).items.length,
      1,
    );
    assert.equal(f.store.commitments.list(f.context, {}).items.length, 0);
    assert.equal(
      f.store.commitments.list(
        { ...f.workerContext, scope: { projectIds: [] } },
        {},
      ).items.length,
      0,
    );
    assert.throws(
      () => f.store.commitments.get({ projectIds: [] }, accepted.id),
      errorCode("not_found"),
    );
    assert.throws(
      () => f.store.commitments.list(f.workerContext, { limit: 51 }),
      errorCode("invalid_input"),
    );
    assert.throws(
      () => f.store.commitments.list(f.workerContext, { since: "2026-11-10" }),
      errorCode("invalid_input"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("commitment request write failure rolls back opening, event and exclusive ownership", async () => {
  const f = fixture();
  try {
    const exclusive = f.store.transmissions.send(f.context, {
      ...f.input,
      idempotencyKey: "exclusive",
      requestMode: "exclusive",
    }).transmission;
    const request = { ...f.wilco, txId: exclusive.id };
    const db = f.bb.storage.database();
    db.exec(
      "CREATE TRIGGER fail_commitment BEFORE INSERT ON commitment_requests BEGIN SELECT RAISE(ABORT, 'request failed'); END",
    );
    assert.throws(
      () => f.store.commitments.act(f.workerContext, request),
      /request failed/,
    );
    assert.equal(
      db
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM commitments")
        .get()!.n,
      0,
    );
    assert.equal(
      db
        .prepare<[], { n: number }>(
          "SELECT count(*) AS n FROM commitment_events",
        )
        .get()!.n,
      0,
    );
    assert.equal(
      db
        .prepare<[string], { id: string | null }>(
          "SELECT commitment_id AS id FROM exclusive_claims WHERE tx_id = ?",
        )
        .get(exclusive.id)!.id,
      null,
    );
    db.exec("DROP TRIGGER fail_commitment");
    const opened = f.store.commitments.act(f.workerContext, request).commitment;
    db.exec(
      "CREATE TRIGGER fail_commitment BEFORE INSERT ON commitment_requests BEGIN SELECT RAISE(ABORT, 'request failed'); END",
    );
    const close = {
      kind: "done",
      commitmentId: opened.id,
      result: "Verified",
      idempotencyKey: "done",
    };
    assert.throws(
      () => f.store.commitments.act(f.workerContext, close),
      /request failed/,
    );
    assert.equal(
      f.store.commitments.get(f.context.scope, opened.id).status,
      "open",
    );
    db.exec("DROP TRIGGER fail_commitment");
    assert.equal(
      f.store.commitments.act(f.workerContext, close).commitment.status,
      "done",
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
