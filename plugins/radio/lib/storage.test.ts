import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import radio from "../server.ts";
import { MIGRATIONS, openRadioStorage } from "./storage.ts";

test("fresh storage allocates one station and repeated initialization preserves it", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const db = bb.storage.database();
    assert.deepEqual(db.prepare("SELECT name FROM sqlite_master").all(), []);
    const store = openRadioStorage(bb.storage);
    assert.match(store.stationId, /^station_[0-9a-f-]{36}$/);
    assert.equal(openRadioStorage(bb.storage).stationId, store.stationId);
    assert.deepEqual(db.prepare("SELECT singleton, id FROM station").all(), [
      { singleton: 1, id: store.stationId },
    ]);
    assert.equal(
      db
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM _bb_migrations")
        .get()?.n,
      MIGRATIONS.length,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("closing and reopening the database and reloading the plugin preserve the station", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    radio(bb);
    const station = openRadioStorage(bb.storage);
    const closed = bb.storage.database();
    closed.close();
    assert.equal(openRadioStorage(bb.storage).stationId, station.stationId);
    const beforeReload = bb.storage.database();
    await harness.lifecycle.reload((next) => {
      radio(next);
      assert.equal(openRadioStorage(next.storage).stationId, station.stationId);
    });
    assert.throws(() => beforeReload.prepare("SELECT id FROM station").get());
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("independent plugin stores do not share a station identity", async () => {
  const first = createFakePluginHost({ pluginId: "radio" });
  const second = createFakePluginHost({ pluginId: "radio" });
  try {
    assert.notEqual(
      openRadioStorage(first.bb.storage).stationId,
      openRadioStorage(second.bb.storage).stationId,
    );
  } finally {
    await first.harness.lifecycle.dispose();
    await second.harness.lifecycle.dispose();
  }
});

test("a failed migration rolls back its batch and prevents station initialization", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const db = bb.storage.database();
    assert.throws(() =>
      radio({
        ...bb,
        storage: {
          ...bb.storage,
          migrate(database, statements) {
            bb.storage.migrate(database, [
              ...statements,
              "CREATE TABLE pending_change(id TEXT)",
              "INVALID SQL",
            ]);
          },
        },
      }),
    );
    assert.deepEqual(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('station', 'pending_change')",
        )
        .all(),
      [],
    );
    assert.deepEqual(db.prepare("SELECT * FROM _bb_migrations").all(), []);
    radio(bb);
    assert.match(openRadioStorage(bb.storage).stationId, /^station_/);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("changed migration history refuses initialization without replacing the station", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const store = openRadioStorage(bb.storage);
    const db = bb.storage.database();
    db.prepare("UPDATE _bb_migrations SET statement_hash = 'changed'").run();
    assert.throws(() => radio(bb), /does not match the recorded statement/);
    assert.deepEqual(db.prepare("SELECT id FROM station").all(), [
      { id: store.stationId },
    ]);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("a failed appended upgrade retains the existing station and migration history", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const store = openRadioStorage(bb.storage);
    const db = bb.storage.database();
    const history = db
      .prepare("SELECT * FROM _bb_migrations ORDER BY id")
      .all();
    assert.throws(() =>
      openRadioStorage({
        ...bb.storage,
        migrate(database, statements) {
          bb.storage.migrate(database, [
            ...statements,
            "CREATE TABLE pending_upgrade(id TEXT)",
            "INVALID SQL",
          ]);
        },
      }),
    );
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name = 'pending_upgrade'",
        )
        .get(),
      undefined,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM _bb_migrations ORDER BY id").all(),
      history,
    );
    assert.equal(openRadioStorage(bb.storage).stationId, store.stationId);
  } finally {
    await harness.lifecycle.dispose();
  }
});
