import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import radio from "../server.ts";
import { openRadioStorage } from "./storage.ts";
import { resultSchema, type SurfaceResult } from "./surface-contract.ts";
import type { Participant, Project } from "./contracts.ts";
import type { Transmission } from "./transmission-contracts.ts";

function fixture(enabled = true) {
  const host = createFakePluginHost({
    pluginId: "radio",
    agentSkillIds: ["radio"],
    settings: { trustedTestEnabled: enabled, trustedTestProject: "proj_local" },
    sdk: {
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
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({ id: threadId, projectId: "proj_local" }),
      },
    },
  });
  radio(host.bb);
  const store = openRadioStorage(host.bb.storage);
  const post = async (path: string, body: unknown) => {
    const response = await host.harness.behavior.fetchHttp("POST", path, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { response, result: resultSchema.parse(await response.json()) };
  };
  const call = (sessionId: string, op: string, input: unknown) =>
    post("/trusted/call", { sessionId, request: { op, input } });
  return { ...host, store, post, call };
}
function data(result: SurfaceResult) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

test("a no-credential outside client registers, replays, polls a BB reply and explicitly confirms receipt without a BB thread", async () => {
  const f = fixture();
  try {
    const registered = await f.post("/trusted/register", {
      sessionId: "outside-client",
      name: "Outside",
      tool: "test-client",
    });
    const first = data(registered.result) as unknown as {
      session: Participant;
      project: Project;
      authentication: string;
    };
    assert.equal(registered.response.status, 200);
    assert.equal(registered.response.headers.get("cache-control"), "no-store");
    assert.equal(first.session.kind, "external-session");
    assert.equal(first.session.provenance, "self-reported");
    assert.ok(first.authentication.includes("no-credentials"));
    const updated = data(
      (
        await f.post("/trusted/register", {
          sessionId: "outside-client",
          name: "Changed claim",
        })
      ).result,
    ) as unknown as typeof first;
    assert.equal(updated.session.id, first.session.id);
    assert.deepEqual(
      f.store.identities.get(first.session.actorId!).metadata,
      {},
    );
    const sessionId = first.session.id;
    data(
      (await f.call(sessionId, "handle-assign", { name: "Outside__Agent" }))
        .result,
    );
    const input = {
      ch: "local-project",
      body: "Review the migration",
      idempotencyKey: "outside-send",
    };
    const sent = data(
      (await f.call(sessionId, "tx", input)).result,
    ) as unknown as { transmission: Transmission; replayed: boolean };
    const replay = data(
      (await f.call(sessionId, "tx", input)).result,
    ) as unknown as typeof sent;
    assert.equal(sent.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.transmission, sent.transmission);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.get").length, 0);
    const response = resultSchema.parse(
      await f.harness.behavior.callRpc("call", {
        context: { threadId: "thr_local", projectId: "proj_local" },
        request: {
          op: "reply",
          input: {
            channelId: first.project.channelId,
            body: "Verified in BB",
            replyToId: sent.transmission.id,
            recipientIds: [sessionId],
            requireAck: true,
            idempotencyKey: "bb-reply",
          },
        },
      }),
    );
    const answer = data(response) as unknown as typeof sent;
    const scan = data(
      (
        await f.call(sessionId, "scan", {
          channelId: first.project.channelId,
          after: sent.transmission.cursor,
        })
      ).result,
    ) as { items: { id: string }[] };
    assert.deepEqual(
      scan.items.map(({ id }) => id),
      [answer.transmission.id],
    );
    data((await f.call(sessionId, "check", {})).result);
    const scope = { projectIds: ["proj_local"] };
    assert.equal(
      f.store.responses.summary(scope, answer.transmission.id)[0]!
        .receivedEndpoints,
      0,
    );
    data(
      (await f.call(sessionId, "read", { id: answer.transmission.id })).result,
    );
    data(
      (
        await f.call(sessionId, "respond", {
          txId: answer.transmission.id,
          targetId: sessionId,
          kind: "received",
          idempotencyKey: "outside-receipt",
        })
      ).result,
    );
    const summary = f.store.responses.summary(
      scope,
      answer.transmission.id,
    )[0]!;
    assert.equal(summary.receivedEndpoints, 1);
    assert.equal(summary.ackAt, null);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.spawn").length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("trusted-test sessions share one principal but claims and foreign canonical IDs never acquire BB/human authority", async () => {
  const f = fixture();
  try {
    const first = data(
      (
        await f.post("/trusted/register", {
          sessionId: "thr_claimed",
          name: "User",
        })
      ).result,
    ) as unknown as { session: Participant };
    const second = data(
      (
        await f.post("/trusted/register", {
          sessionId: "another",
          name: "User",
        })
      ).result,
    ) as unknown as typeof first;
    assert.notEqual(first.session.id, "thr_claimed");
    assert.notEqual(first.session.id, second.session.id);
    assert.equal(first.session.actorId, second.session.actorId);
    assert.equal(first.session.principalId, second.session.principalId);
    const forged = await f.post("/trusted/register", {
      sessionId: "claimed",
      actorId: f.store.identities.human().id,
      principalId: "human",
    });
    assert.equal(forged.response.status, 400);
    const actor = f.store.identities.createActor();
    const bbThread = f.store.identities.registerThread("thr_actual", actor.id);
    const foreign = f.store.identities.registerExternal(
      { principalId: "foreign-principal" },
      { sessionId: "other" },
    );
    for (const id of [bbThread.id, f.store.identities.human().id, foreign.id]) {
      const result = await f.call(id, "whoami", {});
      assert.equal(result.response.status, 403);
      assert.equal(result.result.ok, false);
    }
    const unknown = await f.call("session_unknown", "whoami", {});
    assert.equal(unknown.response.status, 404);
    const claimedContext = await f.post("/trusted/call", {
      sessionId: first.session.id,
      request: { op: "whoami", input: {} },
      context: { asUser: true, operatorCredential: "not-a-real-credential" },
    });
    assert.equal(claimedContext.response.status, 400);
    const reclaim = await f.call(first.session.id, "handle-reclaim", {
      name: "captured",
      targetId: first.session.actorId,
    });
    assert.equal(reclaim.response.status, 403);
    f.store.projects.register("proj_private", "private");
    for (const ch of ["private", "missing"]) {
      const result = await f.call(first.session.id, "tx", {
        ch,
        body: "Probe",
        idempotencyKey: ch,
      });
      assert.equal(result.response.status, 404);
      assert.deepEqual(result.result, {
        ok: false,
        error: {
          code: "not_found",
          message: "Unknown or inaccessible channel.",
          choices: [],
        },
      });
    }
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("trusted HTTP stays disabled until configured and disabling during lookup accepts no identity", async () => {
  const f = fixture(false);
  try {
    const disabled = await f.post("/trusted/register", {
      sessionId: "disabled",
    });
    assert.equal(disabled.response.status, 403);
    assert.equal(f.harness.inspection.sdk.calls.length, 0);
    await f.harness.behavior.setSettings({
      trustedTestEnabled: true,
      trustedTestProject: null,
    });
    assert.equal((await f.post("/trusted/register", {})).response.status, 403);
    await f.harness.behavior.setSettings({ trustedTestProject: "proj_local" });
    let started!: () => void;
    let release!: () => void;
    const begin = new Promise<void>((resolve) => {
      started = resolve;
    });
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.harness.inspection.sdk.stub("projects.get", async () => {
      started();
      await finish;
      return {
        id: "proj_local",
        name: "Local Project",
        kind: "standard",
        sources: [],
        createdAt: 0,
        updatedAt: 0,
        gitRemoteUrl: null,
      };
    });
    const pending = f.post("/trusted/register", { sessionId: "in-flight" });
    await begin;
    await f.harness.behavior.setSettings({ trustedTestEnabled: false });
    release();
    const result = await pending;
    assert.equal(result.response.status, 499);
    assert.equal(
      f.bb.storage
        .database()
        .prepare<[], { n: number }>("SELECT count(*) AS n FROM participants")
        .get()!.n,
      0,
    );
    assert.equal((await f.post("/trusted/register", {})).response.status, 403);
    for (const route of f.harness.inspection.registrations.httpRoutes)
      assert.equal(route.auth, "local");
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
