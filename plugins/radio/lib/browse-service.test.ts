import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { z } from "zod";
import radio from "../server.ts";
import { transmissionFixture } from "./transmission-fixture.ts";
import { browseResultSchema, browseInputSchema } from "./browse-contract.ts";

function fixture() {
  const host = createFakePluginHost({
    pluginId: "radio",
    sdk: {
      projects: {
        get: async ({ projectId }) => ({
          id: projectId,
          name: projectId === "proj_one" ? "one" : "other",
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
  const domain = transmissionFixture(host.bb);
  const browse = async (request: unknown) =>
    browseResultSchema.parse(
      await host.harness.behavior.callRpc("browse", {
        projectId: "proj_one",
        request,
      }),
    );
  return { ...host, ...domain, browse };
}

test("project browsing needs no acting identity and never records receipt, subscriptions or work", async () => {
  const f = fixture();
  try {
    const tx = f.store.transmissions.send(f.context, {
      ...f.input,
      recipientIds: [f.target.id],
      requireAck: true,
    }).transmission;
    const db = f.bb.storage.database();
    const before = db.prepare("SELECT count(*) AS n FROM participants").get();
    const channels = await f.browse({ op: "channels", input: { limit: 1 } });
    assert.equal(channels.ok, true);
    assert.equal(channels.project.id, "proj_one");
    const read = await f.browse({ op: "read", input: { id: tx.id } });
    assert.equal(read.ok, true);
    assert.deepEqual(read.data, JSON.parse(JSON.stringify(tx)));
    const responses = await f.browse({
      op: "response-summary",
      input: { txId: tx.id },
    });
    assert.equal(responses.ok, true);
    assert.deepEqual(responses.data, [
      {
        targetId: f.target.id,
        ackAt: null,
        standbyAt: null,
        squelchAt: null,
        receivedEndpoints: 0,
      },
    ]);
    const history = await f.browse({
      op: "scan",
      input: { channelId: f.project.channelId, limit: 1 },
    });
    assert.equal(history.ok, true);
    const data = history.data as {
      items: Record<string, unknown>[];
      hasMore: boolean;
    };
    assert.equal(data.items.length, 1);
    assert.equal(data.hasMore, false);
    assert.equal("refs" in data.items[0]!, false);
    assert.equal("tokens" in data.items[0]!, false);
    assert.deepEqual(
      db.prepare("SELECT count(*) AS n FROM participants").get(),
      before,
    );
    for (const table of ["response_events", "commitments", "subscriptions"])
      assert.deepEqual(db.prepare(`SELECT count(*) AS n FROM ${table}`).get(), {
        n: 0,
      });
    assert.equal(f.harness.inspection.sdk.callsTo("threads.get").length, 0);
    assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("browse rejects acting operations and scopes canonical history, dispatches and cursors to the verified project", async () => {
  const f = fixture();
  try {
    const hidden = f.store.transmissions.send(
      { ...f.context, scope: { projectIds: [f.other.id] } },
      { ...f.input, channelId: f.other.channelId, idempotencyKey: "hidden" },
    ).transmission;
    const noAccess = await f.browse({ op: "read", input: { id: hidden.id } });
    assert.equal(noAccess.ok, false);
    assert.equal(noAccess.error.code, "not_found");
    const noScan = await f.browse({
      op: "scan",
      input: { channelId: f.other.channelId },
    });
    assert.equal(noScan.ok, false);
    const doc = f.store.dispatches.create(f.context, {
      channelId: f.project.channelId,
      title: "Notes",
      markdown: "# One",
      idempotencyKey: "doc",
    }).dispatch;
    const pinned = await f.browse({
      op: "dispatch-read",
      input: { id: doc.id, revision: 1 },
    });
    assert.equal(pinned.ok, true);
    const before = f.bb.storage
      .database()
      .prepare("SELECT count(*) AS n FROM transmissions")
      .get();
    for (const request of [
      { op: "tx", input: f.input },
      { op: "whoami", input: {} },
      { op: "check", input: {} },
      {
        op: "subscribe",
        input: { channelId: f.project.channelId, kind: "listen" },
      },
      {
        op: "handle-reclaim",
        input: { name: "worker", targetId: f.session.id },
      },
    ])
      await assert.rejects(f.browse(request));
    assert.deepEqual(
      f.bb.storage
        .database()
        .prepare("SELECT count(*) AS n FROM transmissions")
        .get(),
      before,
    );
    await assert.rejects(
      f.harness.behavior.callRpc("browse", {
        projectId: "proj_one",
        asUser: true,
        request: { op: "channels", input: {} },
      }),
    );
    const sub = f.store.projects.addSubchannel(f.project.id, "review").channel;
    const page = await f.browse({ op: "channels", input: { limit: 1 } });
    assert.equal(page.ok, true);
    const first = page.data as {
      items: { id: string }[];
      hasMore: boolean;
      nextCursor: string;
    };
    assert.equal(first.hasMore, true);
    const next = await f.browse({
      op: "channels",
      input: { limit: 1, after: first.nextCursor },
    });
    assert.equal(next.ok, true);
    const second = next.data as { items: { id: string }[]; hasMore: boolean };
    assert.deepEqual(
      new Set([...first.items, ...second.items].map((i) => i.id)),
      new Set([sub.id, f.project.channelId]),
    );
    assert.equal(second.hasMore, false);
  } finally {
    await f.harness.lifecycle.dispose();
  }
});

test("the live-query contracts bundle for browsers without backend or Node imports", () => {
  const publicInput = JSON.stringify(z.toJSONSchema(browseInputSchema));
  assert.equal(publicInput.includes('"const":"tx"'), false);
  assert.equal(publicInput.includes('"const":"scan"'), true);
  const out = mkdtempSync(join(tmpdir(), "radio-contracts-"));
  try {
    execFileSync(
      "bun",
      [
        "build",
        fileURLToPath(new URL("./browse-contract.ts", import.meta.url)),
        fileURLToPath(new URL("./surface-contract.ts", import.meta.url)),
        "--target",
        "browser",
        "--outdir",
        out,
      ],
      { stdio: "pipe" },
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("browse honors SDK cancellation and rejects a mismatched project without creating its mapping", async () => {
  for (const cancel of [false, true]) {
    const abort = new AbortController();
    const host = createFakePluginHost({
      pluginId: "radio",
      sdk: {
        projects: {
          get: async () => {
            if (cancel) abort.abort();
            return {
              id: "proj_other",
              name: "Other",
              kind: "standard",
              sources: [],
              createdAt: 0,
              updatedAt: 0,
              gitRemoteUrl: null,
            };
          },
        },
      },
    });
    try {
      radio(host.bb);
      const result = browseResultSchema.parse(
        await host.harness.behavior.callRpc(
          "browse",
          { projectId: "proj_one", request: { op: "channels", input: {} } },
          { signal: abort.signal },
        ),
      );
      assert.equal(result.ok, false);
      assert.equal(result.error.code, cancel ? "aborted" : "not_found");
      assert.deepEqual(
        host.bb.storage
          .database()
          .prepare("SELECT count(*) AS n FROM projects")
          .get(),
        { n: 0 },
      );
      assert.deepEqual(
        host.bb.storage
          .database()
          .prepare("SELECT count(*) AS n FROM participants")
          .get(),
        { n: 0 },
      );
    } finally {
      await host.harness.lifecycle.dispose();
    }
  }
});

test("exact handle reads normalize within one authorized project, distinguish absence and create no actor", async () => {
  const f = fixture();
  try {
    const before = f.bb.storage
      .database()
      .prepare("SELECT count(*) AS n FROM participants")
      .get();
    f.store.handles.assign(
      f.project.id,
      f.session.id,
      "bounded-name",
      f.context.caller,
    );
    const found = await f.browse({
      op: "handle-read",
      input: { name: "Bounded__Name" },
    });
    assert.equal(found.ok, true);
    assert.deepEqual(found.data, {
      handle: f.store.handles.lookup(f.project.id, "bounded-name"),
    });
    const missing = await f.browse({
      op: "handle-read",
      input: { name: "never-allocated" },
    });
    assert.equal(missing.ok, true);
    assert.deepEqual(missing.data, { handle: null });
    const outside = await f.harness.behavior.callRpc("browse", {
      projectId: f.other.id,
      request: { op: "handle-read", input: { name: "bounded-name" } },
    });
    const other = browseResultSchema.parse(outside);
    assert.equal(other.ok, true);
    assert.deepEqual(other.data, { handle: null });
    assert.deepEqual(
      f.bb.storage
        .database()
        .prepare("SELECT count(*) AS n FROM participants")
        .get(),
      before,
    );
  } finally {
    await f.harness.lifecycle.dispose();
  }
});
