import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openRadioStorage } from "./storage.ts";

test("project and channel renames preserve canonical IDs and repair their names", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const { projects } = openRadioStorage(bb.storage);
    const first = projects.register("proj_first", "Pay__Ments");
    assert.equal(first.project.name, "pay-ments");
    assert.equal(first.normalization.corrected, true);
    assert.deepEqual(
      projects.register("proj_first", "pay--ments").project,
      first.project,
    );
    const sub = projects.addSubchannel("proj_first", "  Cut__Over ");
    assert.equal(sub.channel.parentId, first.project.channelId);
    assert.equal(sub.channel.name, "cut-over");
    const renamed = projects.rename("proj_first", "Accounts--Team");
    assert.equal(renamed.project.id, first.project.id);
    assert.equal(renamed.project.channelId, first.project.channelId);
    const renamedSub = projects.renameChannel(sub.channel.id, "Launch--Plan");
    assert.equal(renamedSub.channel.id, sub.channel.id);
    assert.equal(
      projects.resolvePath("accounts-team/launch-plan").id,
      sub.channel.id,
    );
    assert.equal(
      projects.resolvePath("accounts-team").id,
      first.project.channelId,
    );
    assert.throws(() => projects.resolvePath("pay-ments/cut-over"));
    assert.throws(() =>
      projects.resolvePath("accounts-team/launch-plan/deeper"),
    );
    assert.throws(() =>
      projects.renameChannel(first.project.channelId, "other"),
    );
    bb.storage.database().close();
    assert.equal(
      openRadioStorage(bb.storage).projects.channel(sub.channel.id).id,
      sub.channel.id,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("name collisions and failed project creation never displace existing records", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const { projects } = openRadioStorage(bb.storage);
    const original = projects.register("proj_first", "Payments").project;
    const second = projects.register("proj_second", "Shipping").project;
    assert.throws(() => projects.register("proj_third", "PayMents"));
    assert.throws(() => projects.register("proj_reserved", "CH"));
    assert.throws(() =>
      projects.register("proj_first", "rename-without-intent"),
    );
    assert.throws(() => projects.rename(second.id, "payments"));
    assert.deepEqual(projects.get(original.id), original);
    assert.deepEqual(projects.get(second.id), second);
    projects.addSubchannel(original.id, "cut-over");
    assert.throws(() => projects.addSubchannel(original.id, "cut__over"));
    projects.addSubchannel(second.id, "cut-over");
    const db = bb.storage.database();
    db.exec(
      "CREATE TRIGGER fail_channel BEFORE INSERT ON channels BEGIN SELECT RAISE(ABORT, 'fixture failure'); END",
    );
    assert.throws(() => projects.register("proj_failed", "failed"));
    assert.throws(() => projects.get("proj_failed"));
    assert.throws(() =>
      db
        .prepare("UPDATE projects SET name = 'invalid--name' WHERE id = ?")
        .run(original.id),
    );
    assert.throws(() =>
      db
        .prepare("UPDATE projects SET name = 'invalid_name' WHERE id = ?")
        .run(original.id),
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
