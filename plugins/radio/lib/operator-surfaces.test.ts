import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";

import radio from "../server.ts";
import { openRadioStorage } from "./storage.ts";
import { resultSchema, type SurfaceResult } from "./surface-contract.ts";

function surfaceFixture() {
  const host = createFakePluginHost({
    pluginId: "radio",
    agentSkillIds: ["radio"],
    settings: { operatorCredential: "operator-test-secret" },
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            projectId: "proj_local",
            title: "Working session",
          }),
      },
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: "Local Project",
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
  const store = openRadioStorage(host.bb.storage);
  const invocation = { threadId: "thr_alpha", projectId: "proj_local" };
  const rpc = async (request: unknown, context: unknown = invocation) =>
    resultSchema.parse(
      await host.harness.behavior.callRpc("call", { context, request }),
    );
  const native = async (
    request: unknown,
    threadId = "thr_alpha",
    signal?: AbortSignal,
  ) => {
    const result = await host.harness.behavior.callAgentTool(
      "radio_call",
      { request },
      { ...invocation, threadId, signal },
    );
    assert.notEqual(typeof result, "string");
    if (typeof result === "string")
      throw new Error("Expected structured native result");
    const content = result.content[0]!;
    assert.equal(content.type, "text");
    if (content.type !== "text") throw new Error("Expected text result");
    return resultSchema.parse(JSON.parse(content.text));
  };
  const cli = async (args: string[], context = invocation) => {
    const result = await host.harness.behavior.runCli(
      [...args, "--json"],
      context,
    );
    return {
      execution: result,
      result: resultSchema.parse(JSON.parse(result.stdout)),
    };
  };
  return { ...host, store, invocation, rpc, native, cli };
}
function success(result: SurfaceResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

test("client/plugin labels cannot acquire human authority; explicit operator credentials rotate and never persist", async () => {
  const f = surfaceFixture();
  try {
    await f.native({ op: "whoami", input: {} });
    await f.native({ op: "handle-assign", input: { name: "reserved-name" } });
    const target = f.store.identities.get("thr_alpha").actorId!;
    const request = {
      op: "handle-reclaim",
      input: { targetId: target, name: "reserved-name" },
    };
    const missing = await f.rpc(request, {
      asUser: true,
      projectId: "proj_local",
    });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.code, "forbidden");
    const ordinaryPlugin = await f.harness.behavior.callRpc(
      "call",
      { context: f.invocation, request },
      { experimental_caller: { kind: "plugin", pluginId: "another-plugin" } },
    );
    assert.deepEqual(ordinaryPlugin, await f.rpc(request));
    assert.equal((await f.native(request)).ok, false);
    const context = {
      asUser: true,
      projectId: "proj_local",
      operatorCredential: "operator-test-secret",
    };
    const reclaimed = await f.rpc(request, context);
    success(reclaimed);
    assert.equal(
      f.store.handles.lookup("proj_local", "reserved-name")!.targetId,
      target,
    );
    assert.equal(
      JSON.stringify(reclaimed).includes(context.operatorCredential),
      false,
    );
    const humanSend = await f.cli([
      "tx",
      "Operator message",
      "--ch",
      "local-project",
      "--key",
      "operator-tx",
      "--as-user",
      "--project",
      "proj_local",
      "--operator-credential",
      context.operatorCredential,
    ]);
    success(humanSend.result);
    const requestJson = f.bb.storage
      .database()
      .prepare<[], { request: string }>(
        "SELECT request_json AS request FROM transmissions",
      )
      .get()!.request;
    assert.equal(requestJson.includes(context.operatorCredential), false);
    assert.equal(
      JSON.stringify(humanSend).includes(context.operatorCredential),
      false,
    );
    assert.deepEqual(f.harness.inspection.logEntries, []);
    await f.harness.behavior.setSettings({
      operatorCredential: "rotated-operator-secret",
    });
    assert.equal((await f.rpc({ op: "whoami", input: {} }, context)).ok, false);
    success(
      await f.rpc(
        { op: "whoami", input: {} },
        { ...context, operatorCredential: "rotated-operator-secret" },
      ),
    );
    await f.harness.behavior.setSettings({ operatorCredential: null });
    assert.equal(
      (
        await f.rpc(
          { op: "whoami", input: {} },
          { ...context, operatorCredential: "rotated-operator-secret" },
        )
      ).ok,
      false,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("cancelling native context lookup accepts no tx and registers no detached work", async () => {
  const f = surfaceFixture();
  try {
    let started!: () => void;
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    f.harness.inspection.sdk.stub("threads.get", async ({ signal }) => {
      started();
      await new Promise<void>((_, reject) => {
        (signal as AbortSignal).addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        );
      });
      throw new Error("lookup must not finish");
    });
    const abort = new AbortController();
    const pending = f.native(
      {
        op: "tx",
        input: {
          ch: "local-project",
          body: "Never accepted",
          idempotencyKey: "cancelled",
        },
      },
      "thr_alpha",
      abort.signal,
    );
    await begin;
    abort.abort();
    const result = await pending;
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "aborted");
    assert.equal(
      f.bb.storage
        .database()
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM transmissions")
        .get()!.n,
      0,
    );
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
    assert.equal(f.harness.inspection.registrations.services.length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
