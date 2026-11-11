import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { attentionFixture } from "./attention-fixture.ts";
import { RadioOperations } from "./operations.ts";
import { RadioError } from "./errors.ts";
import { errorCode } from "./transmission-fixture.ts";

test("fully specified operations and hints keep authorized project-only scope without choosing a current project", async () => {
  const host = createFakePluginHost({ pluginId: "radio" });
  const f = attentionFixture(host.bb);
  const ops = new RadioOperations(host.bb.storage.database(), f.store);
  try {
    const sent = f.store.transmissions.send(f.context, {
      ...f.input,
      recipientIds: [f.worker.id],
      requireAck: true,
    }).transmission;
    for (const [op, input] of [
      ["read", { id: sent.id }],
      ["scan", { channelId: f.project.channelId }],
      ["check", {}],
      ["responses", { txId: sent.id }],
      ["response-summary", { txId: sent.id }],
      ["commitments", {}],
      ["listening", {}],
    ] as const)
      assert.doesNotThrow(() => ops.execute(f.workerContext, { op, input }));
    assert.equal(ops.hint(f.workerContext).required.sampleCount, 1);
    const replay = ops.execute(f.context, {
      op: "tx",
      input: { ...f.input, recipientIds: [f.worker.id], requireAck: true },
    }) as { replayed: boolean };
    assert.equal(replay.replayed, true);
    const who = ops.execute(f.context, { op: "whoami", input: {} }) as {
      project: unknown;
      actorId: string;
      handle: unknown;
    };
    assert.equal(who.actorId, f.author.id);
    assert.equal(who.project, null);
    assert.equal(who.handle, null);
    for (const [op, input] of [
      ["channels", {}],
      ["handles", {}],
      ["handle-assign", { name: "chosen" }],
      ["channel-create", { name: "sub" }],
    ] as const)
      assert.throws(
        () => ops.execute(f.context, { op, input }),
        errorCode("invalid_input"),
      );
    assert.throws(
      () =>
        ops.execute(
          {
            ...f.context,
            scope: { projectIds: [f.project.id], currentProjectId: f.other.id },
          },
          { op: "read", input: { id: sent.id } },
        ),
      errorCode("forbidden"),
    );
    assert.equal(
      f.store.responses.summary(f.context.scope, sent.id)[0]!.receivedEndpoints,
      0,
    );
  } finally {
    await host.harness.lifecycle.dispose();
  }
});

test("unknown and out-of-scope posting qualifiers have identical diagnostics without querying private subchannels", async () => {
  const host = createFakePluginHost({ pluginId: "radio" });
  const f = attentionFixture(host.bb);
  try {
    const errors = ["other", "missing", "other/sub", "missing/sub"].map(
      (ch) => {
        try {
          f.store.transmissions.send(f.context, {
            ch,
            body: "Probe",
            idempotencyKey: ch,
          });
          assert.fail("posting must fail");
        } catch (error) {
          assert.ok(error instanceof RadioError);
          return {
            code: error.code,
            message: error.message,
            choices: error.choices,
          };
        }
      },
    );
    assert.deepEqual(
      errors,
      Array.from({ length: 4 }, () => ({
        code: "not_found",
        message: "Unknown or inaccessible channel.",
        choices: [],
      })),
    );
    assert.equal(
      f.store.transmissions.scan(f.context.scope, {
        channelId: f.project.channelId,
      }).items.length,
      0,
    );
    // No qualifier or subchannel lookup can escape the supplied canonical project scope.
    assert.throws(
      () => f.store.projects.resolvePath("other", []),
      errorCode("not_found"),
    );
  } finally {
    await host.harness.lifecycle.dispose();
  }
});
