import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import type { Transmission } from "./transmission-contracts.ts";

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

test("CLI/RPC/native tools share identity, validated send/replay and bounded reads without false receipt", async () => {
  const f = surfaceFixture();
  try {
    const request = { op: "whoami", input: {} };
    const rpc = await f.rpc(request);
    const native = await f.native(request);
    const cli = await f.cli(["whoami"]);
    assert.deepEqual(cli.result, rpc);
    assert.deepEqual(native, rpc);
    assert.equal(cli.execution.exitCode, 0);
    await f.native(request, "thr_beta");
    await f.native(
      { op: "handle-assign", input: { name: "Recipient__Name" } },
      "thr_beta",
    );
    const input = {
      ch: "local-project",
      body: "Ready for review",
      idempotencyKey: "shared",
      recipientIds: ["thr_beta"],
      requireAck: true,
    };
    const first = success(
      (
        await f.cli([
          "tx",
          input.body,
          "--ch",
          input.ch,
          "--key",
          input.idempotencyKey,
          "--to",
          "thr_beta",
          "--require-ack",
        ])
      ).result,
    ) as unknown as { transmission: Transmission; replayed: boolean };
    const replay = success(
      await f.rpc({ op: "tx", input }),
    ) as unknown as typeof first;
    const toolReplay = success(
      await f.native({ op: "tx", input }),
    ) as unknown as typeof first;
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(toolReplay.replayed, true);
    assert.deepEqual(first.transmission, replay.transmission);
    assert.deepEqual(replay.transmission, toolReplay.transmission);
    for (const [op, input] of [
      ["scan", { channelId: first.transmission.channelId }],
      ["read", { id: first.transmission.id }],
      ["check", {}],
    ] as const) {
      const nativeRead = await f.native({ op, input });
      const rpcRead = await f.rpc({ op, input });
      const cliRead = await f.cli([op, "--input", JSON.stringify(input)]);
      assert.deepEqual(cliRead.result, rpcRead);
      assert.deepEqual(nativeRead, rpcRead);
    }
    assert.equal(
      f.store.responses.summary(
        { projectIds: ["proj_local"] },
        first.transmission.id,
      )[0]!.receivedEndpoints,
      0,
    );
    const check = await f.native({ op: "check", input: {} }, "thr_beta");
    assert.equal(check.ok && check.attention.required.sampleCount, 1);
    await f.native(
      { op: "read", input: { id: first.transmission.id } },
      "thr_beta",
    );
    await f.native(
      {
        op: "respond",
        input: {
          kind: "received",
          txId: first.transmission.id,
          targetId: "thr_beta",
          idempotencyKey: "confirmed",
        },
      },
      "thr_beta",
    );
    assert.equal(
      f.store.responses.summary(
        { projectIds: ["proj_local"] },
        first.transmission.id,
      )[0]!.receivedEndpoints,
      1,
    );
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("expected ownership errors match across local surfaces and invalid invocation never selects human", async () => {
  const f = surfaceFixture();
  try {
    await f.native({ op: "whoami", input: {} }, "thr_beta");
    await f.native(
      { op: "handle-assign", input: { name: "beta" } },
      "thr_beta",
    );
    const request = {
      op: "handle-rename",
      input: { targetId: "thr_beta", name: "captured" },
    };
    const rpc = await f.rpc(request);
    const native = await f.native(request);
    const cli = await f.cli([
      request.op,
      "--input",
      JSON.stringify(request.input),
    ]);
    assert.deepEqual(cli.result, rpc);
    assert.deepEqual(native, rpc);
    assert.equal(cli.execution.exitCode, 1);
    assert.equal(rpc.ok, false);
    if (!rpc.ok) assert.equal(rpc.error.code, "forbidden");
    const absent = await f.cli(["whoami"], {} as typeof f.invocation);
    assert.equal(absent.result.ok, false);
    assert.equal(JSON.stringify(absent.result).includes("--thread"), true);
    await assert.rejects(
      f.harness.behavior.callAgentTool(
        "radio_call",
        { request: { op: "whoami", input: {} }, actorId: "claimed" },
        f.invocation,
      ),
    );
    await assert.rejects(
      f.harness.behavior.callRpc("call", {
        context: { actorId: "claimed" },
        request: { op: "whoami", input: {} },
      }),
    );
    assert.equal(f.store.identities.get("thr_beta").kind, "bb-thread");
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("CLI help and native configuration expose only implemented operations with secret stdin metadata", async () => {
  const f = surfaceFixture();
  try {
    const root = await f.harness.behavior.runCli(["--help"]);
    assert.equal(root.exitCode, 0);
    for (const command of [
      "tx",
      "reply",
      "check",
      "dispatch-revise",
      "handle-reclaim",
      "respond",
    ])
      assert.ok(root.stdout.includes(command));
    const help = await f.harness.behavior.runCli(["whoami", "--help"]);
    assert.equal(help.exitCode, 0);
    assert.ok(help.stdout.includes("operator-credential"));
    const responseHelp = await f.harness.behavior.runCli(["respond", "--help"]);
    assert.ok(responseHelp.stdout.includes("targetId"));
    assert.ok(responseHelp.stdout.includes("idempotencyKey"));
    assert.equal(f.harness.inspection.sdk.calls.length, 0);
    const config = await f.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    assert.deepEqual(
      config.tools.map((tool) => (typeof tool === "string" ? tool : tool.name)),
      ["radio_call"],
    );
    assert.deepEqual(config.skills, ["radio"]);
    assert.equal(f.harness.inspection.registrations.httpRoutes.length, 0);
    assert.equal(f.harness.inspection.registrations.services.length, 0);
    assert.equal(f.harness.inspection.registrations.schedules.length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("CLI reply requires one exact mixed actor/session target and never double-covers response obligations", async () => {
  const f = surfaceFixture();
  try {
    const who = success(await f.native({ op: "whoami", input: {} })) as {
      actorId: string;
    };
    await f.native({ op: "handle-assign", input: { name: "alpha-session" } });
    await f.native({
      op: "handle-assign",
      input: { targetId: who.actorId, name: "alpha-actor" },
    });
    const parent = success(
      await f.native(
        {
          op: "tx",
          input: {
            ch: "local-project",
            body: "Verify both targets",
            idempotencyKey: "mixed",
            recipientIds: [who.actorId, "thr_alpha"],
            requireAck: true,
            expectReply: true,
          },
        },
        "thr_beta",
      ),
    ) as unknown as { transmission: Transmission };
    const input = {
      ch: "local-project",
      body: "Session verified",
      replyToId: parent.transmission.id,
      idempotencyKey: "answer",
    };
    const args = [
      "reply",
      input.body,
      "--ch",
      input.ch,
      "--parent",
      input.replyToId,
      "--key",
      input.idempotencyKey,
    ];
    const cli = await f.cli(args);
    const rpc = await f.rpc({ op: "reply", input });
    assert.deepEqual(cli.result, rpc);
    assert.deepEqual(await f.native({ op: "reply", input }), rpc);
    assert.equal(rpc.ok, false);
    if (!rpc.ok) {
      assert.equal(rpc.error.code, "ambiguous");
      assert.deepEqual(
        rpc.error.choices.sort(),
        [who.actorId, "thr_alpha"].sort(),
      );
    }
    const answer = await f.cli([...args, "--reply-for", "thr_alpha"]);
    success(answer.result);
    const required = success(await f.native({ op: "check", input: {} })) as {
      required: {
        items: { targetId: string; needAck: boolean; needReply: boolean }[];
      };
    };
    assert.equal(
      required.required.items.find(({ targetId }) => targetId === "thr_alpha")!
        .needReply,
      false,
    );
    assert.equal(
      required.required.items.find(({ targetId }) => targetId === who.actorId)!
        .needReply,
      true,
    );
    assert.equal(
      required.required.items.every(({ needAck }) => needAck),
      true,
    );
    assert.equal(
      f.store.responses
        .summary({ projectIds: ["proj_local"] }, parent.transmission.id)
        .every(({ receivedEndpoints }) => receivedEndpoints === 0),
      true,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("CLI missing context, invalid flags/JSON and oversized bodies fail without accepting a transmission", async () => {
  const f = surfaceFixture();
  try {
    const missingKey = await f.harness.behavior.runCli([
      "tx",
      "Body",
      "--ch",
      "local-project",
      "--json",
    ]);
    assert.equal(missingKey.exitCode, 1);
    assert.equal(JSON.parse(missingKey.stdout).error.code, "missing_required");
    const oversized = await f.cli([
      "tx",
      "x".repeat(401),
      "--ch",
      "local-project",
      "--key",
      "oversize",
    ]);
    assert.equal(oversized.result.ok, false);
    if (!oversized.result.ok)
      assert.ok(oversized.result.error.message.includes("400"));
    const malformed = await f.cli(["check", "--input", "{bad"]);
    assert.equal(malformed.result.ok, false);
    const unknown = await f.harness.behavior.runCli([
      "whoami",
      "--unknwon",
      "--json",
    ]);
    assert.equal(unknown.exitCode, 1);
    assert.equal(JSON.parse(unknown.stdout).error.code, "unknown_option");
    const noChannel = await f.harness.behavior.runCli([
      "tx",
      "Body",
      "--key",
      "no-channel",
      "--json",
    ]);
    assert.equal(noChannel.exitCode, 1);
    assert.equal(
      f.bb.storage
        .database()
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM transmissions")
        .get()!.n,
      0,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
