import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { LocalContexts } from "./local-context.ts";
import { openRadioStorage } from "./storage.ts";
import { errorCode } from "./transmission-fixture.ts";

function fixture() {
  let secret: string | undefined = "operator-test-secret";
  const host = createFakePluginHost({
    pluginId: "radio",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            projectId: "proj_local",
            title: "Session title",
            parentThreadId: "thr_parent",
          }),
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "Local__Project",
          kind: "standard",
          sources: [],
          createdAt: 0,
          updatedAt: 0,
          gitRemoteUrl: null,
        }),
      },
    },
  });
  const store = openRadioStorage(host.bb.storage);
  const contexts = new LocalContexts(
    host.bb.sdk,
    host.bb.storage.database(),
    store,
    async () => secret,
  );
  const participants = () =>
    host.bb.storage
      .database()
      .prepare<[], { n: number }>("SELECT count(*) AS n FROM participants")
      .get()!.n;
  return {
    ...host,
    store,
    contexts,
    participants,
    rotate: (next: string | undefined) => {
      secret = next;
    },
  };
}

test("local invocation bootstraps one actor/session from a verified BB thread without inheriting parentage", async () => {
  const f = fixture();
  try {
    const first = await f.contexts.resolve({ threadId: "thr_local" });
    const again = await f.contexts.native({
      threadId: "thr_local",
      projectId: "proj_local",
      signal: new AbortController().signal,
    });
    assert.deepEqual(again, first);
    assert.equal(first.sessionId, "thr_local");
    assert.equal(first.caller.kind, "actor");
    assert.deepEqual(first.scope, {
      projectIds: ["proj_local"],
      currentProjectId: "proj_local",
    });
    assert.equal(f.store.projects.get("proj_local").name, "local-project");
    assert.deepEqual(f.store.identities.get(first.authorId).metadata, {});
    assert.equal(
      f.store.identities.get("thr_local").metadata.name,
      "Session title",
    );
    assert.throws(
      () => f.store.identities.get("thr_parent"),
      errorCode("not_found"),
    );
    assert.equal(f.participants(), 2);
    // A BB title/project rename does not silently rename the Radio qualifier or actor.
    f.harness.inspection.sdk.stub("projects.get", async () => ({
      id: "proj_local",
      name: "Renamed",
      kind: "standard",
      sources: [],
      createdAt: 0,
      updatedAt: 0,
      gitRemoteUrl: null,
    }));
    assert.deepEqual(
      await f.contexts.resolve({ threadId: "thr_local" }),
      first,
    );
    assert.equal(f.store.projects.get("proj_local").name, "local-project");
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("missing, mismatched or claimed context never silently gains human authority or writes identities", async () => {
  const f = fixture();
  try {
    for (const input of [
      {},
      { projectId: "proj_local" },
      { actorId: "actor_claim" },
      { principalId: "claimed" },
      { threadId: "thr_local", projectId: "proj_other" },
      { threadId: "thr_local", operatorCredential: "operator-test-secret" },
    ]) {
      await assert.rejects(
        f.contexts.resolve(input),
        errorCode("invalid_input"),
      );
    }
    assert.equal(f.participants(), 0);
    f.harness.inspection.sdk.stub("threads.get", async () =>
      makeThreadResponse({
        id: "thr_local",
        projectId: "proj_local",
        deletedAt: 1,
      }),
    );
    await assert.rejects(
      f.contexts.resolve({ threadId: "thr_local" }),
      errorCode("not_found"),
    );
    assert.equal(f.participants(), 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("operator credential is separate, explicit, rotated immediately and never returned or persisted", async () => {
  const f = fixture();
  try {
    const input = { asUser: true, projectId: "proj_local" };
    for (const operatorCredential of [undefined, "wrong"]) {
      await assert.rejects(
        f.contexts.resolve({ ...input, operatorCredential }),
        errorCode("forbidden"),
      );
    }
    assert.equal(f.participants(), 0);
    const context = await f.contexts.resolve({
      ...input,
      operatorCredential: "operator-test-secret",
    });
    assert.equal(context.caller.kind, "human");
    assert.equal(context.authorId, f.store.identities.human().id);
    assert.equal(context.sessionId, undefined);
    const tx = f.store.transmissions.send(context, {
      body: "Human message",
      channelId: f.store.projects.get("proj_local").channelId,
      idempotencyKey: "human",
    });
    assert.equal(
      JSON.stringify({ context, tx }).includes("operator-test-secret"),
      false,
    );
    const stored = f.bb.storage
      .database()
      .prepare<[], { request: string }>(
        "SELECT request_json AS request FROM transmissions",
      )
      .get()!.request;
    assert.equal(stored.includes("operator"), false);
    f.rotate("replacement-test-secret");
    await assert.rejects(
      f.contexts.resolve({
        ...input,
        operatorCredential: "operator-test-secret",
      }),
      errorCode("forbidden"),
    );
    assert.equal(
      (
        await f.contexts.resolve({
          ...input,
          operatorCredential: "replacement-test-secret",
        })
      ).authorId,
      context.authorId,
    );
    f.rotate(undefined);
    await assert.rejects(
      f.contexts.resolve({
        ...input,
        operatorCredential: "replacement-test-secret",
      }),
      errorCode("forbidden"),
    );
    assert.equal(f.harness.inspection.logEntries.length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("existing explicit actor mapping wins while native calls cannot inherit human or external authority", async () => {
  const f = fixture();
  try {
    const actor = f.store.identities.createActor();
    f.store.identities.registerThread("thr_local", actor.id);
    assert.equal(
      (await f.contexts.resolve({ threadId: "thr_local" })).authorId,
      actor.id,
    );
    const human = f.store.identities.human();
    f.store.identities.registerThread("thr_human", human.id);
    await assert.rejects(
      f.contexts.resolve({ threadId: "thr_human" }),
      errorCode("forbidden"),
    );
    const external = f.store.identities.registerExternal(
      { principalId: "outside" },
      {},
    );
    f.store.identities.registerThread("thr_external", external.actorId!);
    await assert.rejects(
      f.contexts.resolve({ threadId: "thr_external" }),
      errorCode("forbidden"),
    );
    assert.equal(f.participants(), 7);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("aborted SDK lookup and failed bootstrap leave no partial identities or project", async () => {
  const f = fixture();
  try {
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      f.contexts.resolve({ threadId: "thr_local" }, abort.signal),
      { name: "AbortError" },
    );
    assert.equal(f.harness.inspection.sdk.calls.length, 0);
    const duringLookup = new AbortController();
    f.harness.inspection.sdk.stub("threads.get", async () => {
      duringLookup.abort();
      return makeThreadResponse({ id: "thr_local", projectId: "proj_local" });
    });
    await assert.rejects(
      f.contexts.resolve({ threadId: "thr_local" }, duringLookup.signal),
      { name: "AbortError" },
    );
    assert.equal(f.harness.inspection.sdk.callsTo("projects.get").length, 0);
    // Registration failure must roll back the new actor and bootstrapped project together.
    f.harness.inspection.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "not-a-bb-thread", projectId: "proj_local" }),
    );
    await assert.rejects(
      f.contexts.resolve({ threadId: "not-a-bb-thread" }),
      errorCode("invalid_input"),
    );
    assert.equal(f.participants(), 0);
    assert.throws(
      () => f.store.projects.get("proj_local"),
      errorCode("not_found"),
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("verified hyphenated BB IDs and colliding/invalid display names retain independent canonical contexts", async () => {
  const f = fixture();
  try {
    const first = await f.contexts.resolve({ threadId: "thr_thread-1" });
    assert.equal(first.sessionId, "thr_thread-1");
    for (const [index, name] of [
      "Local-Project",
      "x".repeat(300),
      "ch",
      "---",
    ].entries()) {
      const projectId = `proj_fallback${index}`;
      const threadId = `thr_thread-${index + 2}`;
      f.harness.inspection.sdk.stub("threads.get", async () =>
        makeThreadResponse({ id: threadId, projectId }),
      );
      f.harness.inspection.sdk.stub("projects.get", async () => ({
        id: projectId,
        name,
        kind: "standard",
        sources: [],
        createdAt: 0,
        updatedAt: 0,
        gitRemoteUrl: null,
      }));
      const context = await f.contexts.resolve({ threadId });
      const project = f.store.projects.get(projectId);
      assert.match(project.name, /^project-[a-f0-9]{56}$/);
      assert.equal(project.name.length, 64);
      assert.notEqual(
        project.channelId,
        f.store.projects.get("proj_local").channelId,
      );
      assert.equal(context.sessionId, threadId);
      assert.notEqual(context.authorId, first.authorId);
      assert.deepEqual(await f.contexts.resolve({ threadId }), context);
      // Explicitly renamed/allocated qualifiers are never displaced by bootstrap.
      f.store.projects.rename(projectId, `chosen-${index}`);
      assert.deepEqual(await f.contexts.resolve({ threadId }), context);
      assert.equal(f.store.projects.get(projectId).name, `chosen-${index}`);
    }
    assert.equal(f.store.projects.get("proj_local").name, "local-project");
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
