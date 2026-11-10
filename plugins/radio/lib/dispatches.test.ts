import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { transmissionFixture, errorCode } from "./transmission-fixture.ts";
import { openRadioStorage } from "./storage.ts";

function fixture() {
  const host = createFakePluginHost({ pluginId: "radio" });
  const f = { ...host, ...transmissionFixture(host.bb) };
  return {
    ...f,
    request: {
      channelId: f.project.channelId,
      title: "Cutover plan",
      markdown: "# Plan\n\nFirst revision.",
      idempotencyKey: "create",
    },
  };
}

test("dispatch revisions retain exact content and stable identity across edits/reopen", async () => {
  const f = fixture();
  try {
    const first = f.store.dispatches.create(f.context, f.request);
    assert.equal(first.replayed, false);
    assert.equal(first.dispatch.revision, 1);
    assert.equal(first.dispatch.markdown, f.request.markdown);
    const update = {
      id: first.dispatch.id,
      expectedRevision: 1,
      title: "Updated plan",
      markdown: "# Updated\n\nSecond revision.",
      idempotencyKey: "edit",
    };
    const second = f.store.dispatches.revise(f.context, update);
    assert.equal(second.dispatch.id, first.dispatch.id);
    assert.equal(second.dispatch.revision, 2);
    f.store.projects.rename(f.project.id, "new-project-name");
    f.bb.storage.database().close();
    const reopened = openRadioStorage(f.bb.storage);
    assert.deepEqual(
      reopened.dispatches.get(f.context.scope, {
        id: first.dispatch.id,
        revision: 1,
      }),
      first.dispatch,
    );
    assert.deepEqual(
      reopened.dispatches.get(f.context.scope, { id: first.dispatch.id }),
      second.dispatch,
    );
    assert.throws(
      () =>
        reopened.dispatches.get(f.context.scope, {
          id: first.dispatch.id,
          revision: 3,
        }),
      errorCode("not_found"),
    );
    assert.deepEqual(reopened.dispatches.create(f.context, f.request), {
      replayed: true,
      dispatch: first.dispatch,
    });
    assert.deepEqual(reopened.dispatches.revise(f.context, update), {
      replayed: true,
      dispatch: second.dispatch,
    });
    assert.throws(
      () =>
        reopened.dispatches.revise(f.context, {
          ...update,
          markdown: "changed",
        }),
      errorCode("conflict"),
    );
    assert.throws(
      () =>
        reopened.dispatches.revise(f.context, {
          ...update,
          idempotencyKey: "stale",
        }),
      /current revision 2/,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("dispatch writes require owned author/session and original author or explicit human", async () => {
  const f = fixture();
  try {
    const first = f.store.dispatches.create(f.context, f.request).dispatch;
    const update = {
      id: first.id,
      expectedRevision: 1,
      title: "Changed",
      markdown: "Content",
      idempotencyKey: "edit",
    };
    const otherContext = {
      ...f.context,
      authorId: f.target.id,
      sessionId: undefined,
      caller: { kind: "actor" as const, actorId: f.target.id },
    };
    assert.throws(
      () => f.store.dispatches.revise(otherContext, update),
      errorCode("forbidden"),
    );
    assert.throws(
      () =>
        f.store.dispatches.create(
          { ...f.context, authorId: f.target.id },
          f.request,
        ),
      errorCode("forbidden"),
    );
    const edited = f.store.dispatches.revise(
      {
        ...f.context,
        authorId: f.human.id,
        sessionId: undefined,
        caller: { kind: "human", actorId: f.human.id },
      },
      update,
    ).dispatch;
    assert.equal(edited.editorId, f.human.id);
    assert.equal(edited.authorId, f.author.id);
    assert.equal(edited.sessionId, null);
    const ownEdit = f.store.dispatches.revise(f.context, {
      ...update,
      expectedRevision: 2,
    }).dispatch;
    assert.equal(ownEdit.revision, 3);
    assert.equal(ownEdit.editorId, f.author.id);
    assert.equal(ownEdit.sessionId, f.session.id);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("dispatch content, replay, list and tx refs all require project access", async () => {
  const f = fixture();
  try {
    const privateContext = {
      ...f.context,
      scope: { projectIds: [f.other.id] },
    };
    const request = { ...f.request, channelId: f.other.channelId };
    const secret = f.store.dispatches.create(privateContext, request).dispatch;
    assert.throws(
      () => f.store.dispatches.get(f.context.scope, { id: secret.id }),
      errorCode("not_found"),
    );
    assert.throws(
      () =>
        f.store.dispatches.list(f.context.scope, {
          channelId: f.other.channelId,
        }),
      errorCode("not_found"),
    );
    assert.throws(
      () => f.store.dispatches.create(f.context, request),
      errorCode("not_found"),
    );
    assert.throws(
      () =>
        f.store.dispatches.revise(f.context, {
          id: secret.id,
          expectedRevision: 1,
          title: "x",
          markdown: "x",
          idempotencyKey: "edit",
        }),
      errorCode("not_found"),
    );
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          refs: [{ kind: "dispatch", id: secret.id }],
        }),
      errorCode("not_found"),
    );
    assert.throws(
      () =>
        f.store.dispatches.create(f.context, {
          ...f.request,
          authorId: f.target.id,
        }),
      errorCode("invalid_input"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("latest dispatch refs pin on send and exact retry cannot float to a later revision", async () => {
  const f = fixture();
  try {
    const doc = f.store.dispatches.create(f.context, f.request).dispatch;
    const request = { ...f.input, refs: [{ kind: "dispatch", id: doc.id }] };
    const first = f.store.transmissions.send(f.context, request);
    assert.deepEqual(first.transmission.refs, [
      { kind: "dispatch", id: doc.id, revision: 1 },
    ]);
    f.store.dispatches.revise(f.context, {
      id: doc.id,
      expectedRevision: 1,
      title: "New plan",
      markdown: "New content",
      idempotencyKey: "edit",
    });
    assert.deepEqual(
      f.store.transmissions.send(f.context, request).transmission,
      first.transmission,
    );
    const latest = f.store.transmissions.send(f.context, {
      ...request,
      idempotencyKey: "latest",
    }).transmission;
    assert.deepEqual(latest.refs, [
      { kind: "dispatch", id: doc.id, revision: 2 },
    ]);
    const pinned = f.store.transmissions.send(f.context, {
      ...request,
      idempotencyKey: "pinned",
      refs: [{ kind: "dispatch", id: doc.id, revision: 1 }],
    }).transmission;
    assert.deepEqual(pinned.refs, first.transmission.refs);
    assert.throws(
      () =>
        f.store.transmissions.send(f.context, {
          ...f.input,
          idempotencyKey: "bad-ref",
          refs: [{ kind: "dispatch", id: doc.id, revision: 9 }],
        }),
      errorCode("not_found"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("dispatch request failure rolls back revision/latest/key and permits a clean retry", async () => {
  const f = fixture();
  try {
    const db = f.bb.storage.database();
    db.exec(
      "CREATE TRIGGER fail_dispatch BEFORE INSERT ON dispatch_requests BEGIN SELECT RAISE(ABORT, 'audit write failed'); END",
    );
    assert.throws(
      () => f.store.dispatches.create(f.context, f.request),
      /audit write failed/,
    );
    assert.equal(
      db
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM dispatches")
        .get()!.n,
      0,
    );
    db.exec("DROP TRIGGER fail_dispatch");
    const doc = f.store.dispatches.create(f.context, f.request).dispatch;
    db.exec(
      "CREATE TRIGGER fail_dispatch BEFORE INSERT ON dispatch_requests BEGIN SELECT RAISE(ABORT, 'audit write failed'); END",
    );
    const update = {
      id: doc.id,
      expectedRevision: 1,
      title: "Changed",
      markdown: "new",
      idempotencyKey: "edit",
    };
    assert.throws(
      () => f.store.dispatches.revise(f.context, update),
      /audit write failed/,
    );
    assert.deepEqual(
      f.store.dispatches.get(f.context.scope, { id: doc.id }),
      doc,
    );
    assert.equal(
      db
        .prepare<[], { n: number }>(
          "SELECT count(*) AS n FROM dispatch_revisions",
        )
        .get()!.n,
      1,
    );
    db.exec("DROP TRIGGER fail_dispatch");
    assert.equal(
      f.store.dispatches.revise(f.context, update).dispatch.revision,
      2,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("dispatch byte/title limits fail clearly and bounded lists omit Markdown payloads", async () => {
  const f = fixture();
  try {
    const maximum = f.store.dispatches.create(f.context, {
      ...f.request,
      markdown: "😀".repeat(16_384),
    }).dispatch;
    assert.equal(Buffer.byteLength(maximum.markdown), 65_536);
    for (const change of [
      { markdown: "😀".repeat(16_385) },
      { markdown: " " },
      { title: " " },
      { title: "x".repeat(121) },
    ])
      assert.throws(
        () => f.store.dispatches.create(f.context, { ...f.request, ...change }),
        errorCode("invalid_input"),
      );
    const next = f.store.dispatches.create(f.context, {
      ...f.request,
      idempotencyKey: "second",
    }).dispatch;
    const page = f.store.dispatches.list(f.context.scope, {
      channelId: f.project.channelId,
      limit: 1,
    });
    assert.deepEqual(
      page.items.map(({ id }) => id),
      [maximum.id],
    );
    assert.equal(page.hasMore, true);
    assert.equal("markdown" in page.items[0]!, false);
    f.store.dispatches.revise(f.context, {
      id: maximum.id,
      expectedRevision: 1,
      title: "Edited earlier document",
      markdown: "Updated",
      idempotencyKey: "edit-earlier",
    });
    const refreshed = f.store.dispatches.list(f.context.scope, {
      channelId: f.project.channelId,
      limit: 1,
    });
    assert.equal(refreshed.items[0]!.revision, 2);
    assert.equal(refreshed.items[0]!.title, "Edited earlier document");
    assert.equal(refreshed.nextCursor, page.nextCursor);
    const last = f.store.dispatches.list(f.context.scope, {
      channelId: f.project.channelId,
      after: page.nextCursor,
      limit: 1,
    });
    assert.deepEqual(
      last.items.map(({ id }) => id),
      [next.id],
    );
    assert.equal(last.hasMore, false);
    for (const change of [{ limit: 51 }, { after: -1 }])
      assert.throws(
        () =>
          f.store.dispatches.list(f.context.scope, {
            channelId: f.project.channelId,
            ...change,
          }),
        errorCode("invalid_input"),
      );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
