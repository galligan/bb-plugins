import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openRadioStorage } from "./storage.ts";

test("human and BB identities persist through reopen and do not inherit thread parentage", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const store = openRadioStorage(bb.storage);
    const human = store.identities.human();
    assert.equal(store.identities.human().id, human.id);
    assert.equal(human.provenance, "station");
    const actor = store.identities.createActor({ name: "Collaborator" });
    const first = store.identities.registerThread("thr_first", actor.id, {
      model: "reported-by-bb",
    });
    const second = store.identities.registerThread("thr_second", actor.id);
    assert.equal(first.id, "thr_first");
    assert.notEqual(first.id, second.id);
    assert.equal(first.actorId, second.actorId);
    assert.equal(first.stationId, store.stationId);
    assert.equal(first.provenance, "bb");
    assert.throws(() => store.identities.registerThread("thr_first", human.id));
    assert.throws(() => store.identities.registerThread("thr_third", first.id));
    bb.storage.database().close();
    const reopened = openRadioStorage(bb.storage);
    assert.deepEqual(reopened.identities.get(first.id), first);
    assert.equal(reopened.identities.human().id, human.id);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("external client session IDs are principal-scoped and metadata never conveys authority", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const { identities } = openRadioStorage(bb.storage);
    const first = identities.registerExternal(
      { principalId: "trusted-one" },
      { sessionId: "thr_first", name: "Matt", provider: "self-report" },
    );
    const other = identities.registerExternal(
      { principalId: "trusted-two" },
      { sessionId: "thr_first", name: "Matt" },
    );
    assert.notEqual(first.id, other.id);
    assert.notEqual(first.actorId, other.actorId);
    assert.notEqual(first.id, "thr_first");
    assert.notEqual(first.actorId, identities.human().id);
    assert.equal(first.principalId, "trusted-one");
    assert.equal(first.provenance, "self-reported");
    assert.deepEqual(identities.get(first.actorId!).metadata, {});
    assert.equal(identities.get(first.actorId!).provenance, "station");
    const again = identities.registerExternal(
      { principalId: "trusted-one" },
      { sessionId: "thr_first", model: "new-report" },
    );
    assert.equal(again.id, first.id);
    assert.equal(again.actorId, first.actorId);
    assert.deepEqual(again.metadata, { model: "new-report" });
    assert.deepEqual(identities.get(first.actorId!).metadata, {});
    for (const extra of [
      { actorId: other.actorId },
      { principalId: "trusted-two" },
      { provenance: "bb" },
      { id: "thr_first" },
    ])
      assert.throws(() =>
        identities.registerExternal(
          { principalId: "trusted-one" },
          { sessionId: "thr_first", ...extra },
        ),
      );
    const anonymous = identities.registerExternal(
      { principalId: "trusted-one" },
      {},
    );
    const nextAnonymous = identities.registerExternal(
      { principalId: "trusted-one" },
      {},
    );
    assert.notEqual(anonymous.id, nextAnonymous.id);
    assert.equal(anonymous.actorId, first.actorId);
    assert.deepEqual(identities.get(anonymous.actorId!).metadata, {});
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("the shipped station schema upgrades without rewriting identity or migration history", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const db = bb.storage.database();
    // Exact statement shipped in the foundation release, independent of current migrations.
    bb.storage.migrate(db, [
      `CREATE TABLE station (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    id TEXT NOT NULL UNIQUE CHECK(length(id) > 0)
  ) STRICT`,
    ]);
    db.prepare(
      "INSERT INTO station(singleton, id) VALUES (1, 'station-original')",
    ).run();
    const history = db
      .prepare("SELECT statement_hash FROM _bb_migrations WHERE id = 0")
      .get();
    const store = openRadioStorage(bb.storage);
    assert.equal(store.stationId, "station-original");
    assert.deepEqual(
      db
        .prepare("SELECT statement_hash FROM _bb_migrations WHERE id = 0")
        .get(),
      history,
    );
    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    const human = store.identities.human();
    await harness.lifecycle.reload((next) => {
      const reloaded = openRadioStorage(next.storage);
      assert.equal(reloaded.identities.human().id, human.id);
    });
    assert.throws(() => store.identities.get(human.id));
  } finally {
    await harness.lifecycle.dispose();
  }
});
