import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import radio from "../server.ts";
import { resultSchema } from "./surface-contract.ts";
import { openRadioStorage } from "./storage.ts";
import { operationIsRead } from "./operations.ts";

test("human profile updates require current operator authority across RPC/CLI/native and preserve canonical records", async () => {
  const host = createFakePluginHost({
    pluginId: "radio",
    settings: { operatorCredential: "profile-test-secret" },
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({ id: threadId, projectId: "proj_profile" }),
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "Profile",
          kind: "standard",
          sources: [],
          createdAt: 0,
          updatedAt: 0,
          gitRemoteUrl: null,
        }),
      },
    },
  });
  radio(host.bb);
  const projectId = "proj_profile";
  const ordinary = { projectId, threadId: "thr_profile" };
  const operator = {
    projectId,
    asUser: true,
    operatorCredential: "profile-test-secret",
  };
  const rpc = async (op: string, input = {}, context: unknown = ordinary) =>
    resultSchema.parse(
      await host.harness.behavior.callRpc("call", {
        context,
        request: { op, input },
      }),
    );
  try {
    const store = openRadioStorage(host.bb.storage);
    const human = store.identities.human();
    const sent = await rpc("tx", {
      body: "@user please review",
      ch: "profile",
      idempotencyKey: "before-profile",
    });
    assert.ok(sent.ok);
    assert.equal((await rpc("human-profile")).ok, false);
    assert.equal(
      (await rpc("human-profile-set", { displayName: "Impersonation" })).ok,
      false,
    );
    for (const context of [
      { projectId, asUser: true },
      { projectId, asUser: true, operatorCredential: "wrong" },
    ])
      assert.equal(
        (await rpc("human-profile-set", { displayName: "No" }, context)).ok,
        false,
      );
    const tool = await host.harness.behavior.callAgentTool(
      "radio_call",
      {
        request: {
          op: "human-profile-set",
          input: { displayName: "Tool cannot be human" },
        },
      },
      ordinary,
    );
    assert.notEqual(typeof tool, "string");
    if (typeof tool !== "string") assert.equal(tool.isError, true);
    const result = await rpc(
      "human-profile-set",
      { displayName: "  Human Name  " },
      operator,
    );
    assert.ok(result.ok);
    assert.deepEqual(result.data, {
      stationId: store.stationId,
      actorId: human.id,
      displayName: "Human Name",
    });
    assert.equal(store.identities.human().id, human.id);
    assert.equal(store.identities.human().metadata.name, "Human Name");
    for (const displayName of ["   ", "x".repeat(257)])
      await assert.rejects(() =>
        rpc("human-profile-set", { displayName }, operator),
      );
    await assert.rejects(() =>
      rpc(
        "human-profile-set",
        { displayName: "Bad", actorId: human.id },
        operator,
      ),
    );
    const cli = await host.harness.behavior.runCli(
      [
        "human-profile",
        "--as-user",
        "--project",
        projectId,
        "--operator-credential",
        operator.operatorCredential,
        "--input",
        "{}",
        "--json",
      ],
      ordinary,
    );
    const read = resultSchema.parse(JSON.parse(cli.stdout));
    assert.ok(read.ok);
    assert.deepEqual(read.data, result.data);
    const tx = store.transmissions.get(
      (sent.data as { transmission: { id: string } }).transmission.id,
      { projectIds: [projectId], currentProjectId: projectId },
    );
    assert.deepEqual(tx.recipientIds, [human.id]);
    await host.harness.behavior.setSettings({
      operatorCredential: "rotated-profile-secret",
    });
    assert.equal(
      (await rpc("human-profile-set", { displayName: "Old secret" }, operator))
        .ok,
      false,
    );
    assert.equal(store.identities.human().metadata.name, "Human Name");
    assert.equal(
      JSON.stringify(host.harness.inspection.logEntries).includes(
        operator.operatorCredential,
      ),
      false,
    );
    const row = host.bb.storage
      .database()
      .prepare<[string], { metadata: string }>(
        "SELECT metadata_json AS metadata FROM participants WHERE id = ?",
      )
      .get(human.id)!;
    assert.equal(row.metadata.includes(operator.operatorCredential), false);
    assert.equal(operationIsRead("human-profile"), true);
    assert.equal(operationIsRead("human-profile-set"), false);
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
