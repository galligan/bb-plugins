import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openRadioStorage } from "./storage.ts";

test("manual handles repair spelling, preserve aliases and require ownership", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const store = openRadioStorage(bb.storage);
    store.projects.register("proj_one", "One");
    const owner = store.identities.createActor();
    const other = store.identities.createActor();
    const caller = { kind: "actor" as const, actorId: owner.id };
    const session = store.identities.registerThread("thr_one", owner.id);
    const assigned = store.handles.assign(
      "proj_one",
      session.id,
      "Agent__Name",
      caller,
    );
    assert.equal(assigned.handle.name, "agent-name");
    assert.equal(assigned.normalization.corrected, true);
    assert.equal(
      store.handles.assign("proj_one", session.id, "agent--name", caller).handle
        .targetId,
      session.id,
    );
    store.handles.rename("proj_one", session.id, "new-name", caller);
    assert.equal(
      store.handles.lookup("proj_one", "agent-name")?.targetId,
      session.id,
    );
    assert.equal(
      store.handles.lookup("proj_one", "agent-name")?.isPrimary,
      false,
    );
    assert.throws(() =>
      store.handles.rename("proj_one", session.id, "stolen", {
        kind: "actor",
        actorId: other.id,
      }),
    );
    assert.throws(() =>
      store.handles.assign("proj_one", other.id, "agent-name", {
        kind: "actor",
        actorId: other.id,
      }),
    );
    store.handles.rename("proj_one", session.id, "agent-name", caller);
    store.handles.removeAlias("proj_one", "new-name", caller);
    assert.equal(store.handles.lookup("proj_one", "new-name"), null);
    assert.throws(() =>
      store.handles.removeAlias("proj_one", "agent-name", caller),
    );
    for (const name of ["USER", "--user--", "ｃｈ"])
      assert.throws(() =>
        store.handles.assign("proj_one", other.id, name, {
          kind: "actor",
          actorId: other.id,
        }),
      );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("human reclaim is atomic, audited and does not change canonical targets", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const store = openRadioStorage(bb.storage);
    store.projects.register("proj_one", "one");
    const first = store.identities.createActor();
    const second = store.identities.createActor();
    const third = store.identities.createActor();
    const human = {
      kind: "human" as const,
      actorId: store.identities.human().id,
    };
    store.handles.assign("proj_one", first.id, "reviewer", human);
    store.handles.assign("proj_one", second.id, "other", human);
    store.handles.assign("proj_one", third.id, "reviewer-2", human);
    store.handles.rename("proj_one", third.id, "third", human);
    const oldTarget = store.handles.lookup("proj_one", "reviewer")!.targetId;
    assert.throws(() =>
      store.handles.reclaim("proj_one", second.id, "reviewer", {
        kind: "actor",
        actorId: second.id,
      }),
    );
    const result = store.handles.reclaim(
      "proj_one",
      second.id,
      "Reviewer",
      human,
    );
    assert.deepEqual(result.displaced, {
      targetId: first.id,
      fallbackName: "reviewer-3",
    });
    assert.equal(
      store.handles.lookup("proj_one", "reviewer")!.targetId,
      second.id,
    );
    assert.equal(
      store.handles.primary("proj_one", first.id)!.name,
      "reviewer-3",
    );
    assert.equal(store.handles.lookup("proj_one", "other")!.isPrimary, false);
    assert.equal(store.identities.get(oldTarget).id, first.id);
    assert.equal(
      bb.storage.database().prepare("SELECT * FROM handle_reassignments").all()
        .length,
      1,
    );
    store.handles.reclaim("proj_one", second.id, "reviewer", human);
    assert.equal(
      bb.storage.database().prepare("SELECT * FROM handle_reassignments").all()
        .length,
      1,
    );
    bb.storage.database().close();
    assert.equal(
      openRadioStorage(bb.storage).handles.lookup("proj_one", "reviewer")!
        .targetId,
      second.id,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("reclaiming an alias retains its old holder's current primary; failed audit rolls back all changes", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const store = openRadioStorage(bb.storage);
    store.projects.register("proj_one", "one");
    const first = store.identities.createActor();
    const second = store.identities.createActor();
    const human = {
      kind: "human" as const,
      actorId: store.identities.human().id,
    };
    store.handles.assign("proj_one", first.id, "old-name", human);
    store.handles.rename("proj_one", first.id, "current-name", human);
    const result = store.handles.reclaim(
      "proj_one",
      second.id,
      "old-name",
      human,
    );
    assert.equal(result.displaced!.fallbackName, "current-name");
    assert.equal(
      store.handles.primary("proj_one", first.id)!.name,
      "current-name",
    );
    const db = bb.storage.database();
    const before = db.prepare("SELECT * FROM handles ORDER BY name").all();
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON handle_reassignments BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    assert.throws(() =>
      store.handles.reclaim("proj_one", second.id, "current-name", human),
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM handles ORDER BY name").all(),
      before,
    );
    assert.equal(
      db.prepare("SELECT * FROM handle_reassignments").all().length,
      1,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("external metadata and aliases never grant permission to mutate or reclaim another identity", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const store = openRadioStorage(bb.storage);
    store.projects.register("proj_one", "one");
    const first = store.identities.registerExternal(
      { principalId: "one" },
      { sessionId: "same", name: "Matt" },
    );
    const second = store.identities.registerExternal(
      { principalId: "two" },
      { sessionId: "same", name: "Matt" },
    );
    const caller = { kind: "principal" as const, principalId: "one" };
    store.handles.assign("proj_one", first.id, "worker", caller);
    store.handles.rename("proj_one", first.id, "owner", caller);
    assert.throws(() =>
      store.handles.rename("proj_one", second.id, "worker", caller),
    );
    assert.throws(() =>
      store.handles.reclaim("proj_one", first.id, "other", caller),
    );
    assert.throws(() =>
      store.handles.reclaim("proj_one", first.id, "other", {
        kind: "human",
        actorId: first.actorId!,
      }),
    );
    assert.equal(
      store.handles.lookup("proj_one", "worker")!.targetId,
      first.id,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test(
  "concurrent allocation on separate SQLite connections has exactly one winner",
  { timeout: 15_000 },
  async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
    const workers: Worker[] = [];
    try {
      const store = openRadioStorage(bb.storage);
      store.projects.register("proj_one", "one");
      const dbPath = (
        bb.storage.database().pragma("database_list") as {
          name: string;
          file: string;
        }[]
      ).find((row) => row.name === "main")!.file;
      const actors = [
        store.identities.createActor(),
        store.identities.createActor(),
      ];
      const ready: Promise<void>[] = [];
      const outcomes: Promise<string>[] = [];
      const exits: Promise<void>[] = [];
      for (const actor of actors) {
        const worker = new Worker(
          new URL("./handle-allocation.worker.ts", import.meta.url),
          {
            workerData: {
              dbPath,
              stationId: store.stationId,
              actorId: actor.id,
            },
          },
        );
        workers.push(worker);
        ready.push(
          new Promise((resolve, reject) => {
            worker.once("message", () => resolve());
            worker.once("error", reject);
          }),
        );
        outcomes.push(
          new Promise((resolve, reject) => {
            worker.on("message", (message) => {
              if (message.result) resolve(message.result);
            });
            worker.once("error", reject);
          }),
        );
        exits.push(
          new Promise((resolve, reject) => {
            worker.once("exit", (code) =>
              code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)),
            );
          }),
        );
      }
      await Promise.all(ready);
      for (const worker of workers) worker.postMessage("go");
      assert.deepEqual((await Promise.all(outcomes)).sort(), [
        "conflict",
        "success",
      ]);
      await Promise.all(exits);
      assert.equal(
        bb.storage.database().prepare("SELECT * FROM handles").all().length,
        1,
      );
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      await harness.lifecycle.dispose();
    }
  },
);
