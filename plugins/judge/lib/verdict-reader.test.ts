import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { setupTriggers, triggerHostOptions } from "./trigger-fixtures.ts";
const thread = makeThreadResponse({
  id: "thread",
  projectId: "project",
  environmentId: "exact-env",
  providerId: "codex",
  status: "idle",
  updatedAt: 1000,
  archivedAt: null,
  deletedAt: null,
});
async function setup() {
  const controls = triggerHostOptions(thread);
  return setupTriggers(createFakePluginHost(controls.options), controls);
}

test("keyed verdict reads validate published metadata against current DB evidence and never expose answers/state", async () => {
  const h = await setup();
  try {
    h.enable();
    await h.engine.idle(h.idle());
    const value = (await h.harness.behavior.callRpc("verdicts.keyed", {
      threadIds: ["thread", "missing"],
    })) as {
      threads: {
        threadId: string;
        summaries: unknown[];
        publicationFailure: string | null;
      }[];
    };
    assert.equal(value.threads[0]?.summaries.length, 1);
    assert.equal(value.threads[1]?.summaries.length, 0);
    assert.ok(!JSON.stringify(value).includes("answers"));
    assert.ok(!JSON.stringify(value).includes("SYNTHETIC_CURRENT_REPLY"));
    const original = structuredClone(h.metadata.get("thread")) as {
      verdicts: { summaries: { runId: string }[] };
    };
    const forged = structuredClone(original);
    forged.verdicts.summaries[0]!.runId = "forged";
    h.metadata.set("thread", forged);
    const hidden = await h.api.verdicts.keyed({ threadIds: ["thread"] });
    assert.equal(hidden.threads[0]?.summaries.length, 0);
    assert.equal(hidden.threads[0]?.publicationFailure, "stale_metadata");
    h.metadata.set("thread", {
      ...original,
      state: "PRIVATE_UNTRUSTED_METADATA",
    });
    const invalid = await h.api.verdicts.keyed({ threadIds: ["thread"] });
    assert.equal(invalid.threads[0]?.summaries.length, 0);
    assert.equal(invalid.threads[0]?.publicationFailure, "invalid_metadata");
    assert.ok(!JSON.stringify(invalid).includes("PRIVATE_UNTRUSTED_METADATA"));
    h.metadata.set("thread", original);
    h.triggers.enable("binding", false);
    assert.equal(
      (await h.api.verdicts.keyed({ threadIds: ["thread"] })).threads[0]
        ?.summaries.length,
      0,
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("keyed reads enforce 200 unique requested keys, reject unknown SDK rows and propagate cancellation", async () => {
  const h = await setup();
  try {
    assert.equal(
      (
        await h.api.verdicts.keyed({
          threadIds: Array.from({ length: 200 }, (_, i) => `thread${i}`),
        })
      ).threads.length,
      200,
    );
    for (const ids of [
      [],
      ["thread", "thread"],
      Array.from({ length: 201 }, (_, i) => `thread${i}`),
    ])
      await assert.rejects(
        h.harness.behavior.callRpc("verdicts.keyed", { threadIds: ids }),
      );
    h.harness.sdk.stub("threads.experimental_listPluginMetadata", async () => ({
      threads: [{ threadId: "wrong", metadata: {} }],
    }));
    await assert.rejects(
      h.harness.behavior.callRpc("verdicts.keyed", { threadIds: ["thread"] }),
      /operation_failed/,
    );
    const caller = new AbortController();
    let reads = 0;
    h.harness.sdk.stub("threads.experimental_listPluginMetadata", async () => {
      reads++;
      queueMicrotask(() => caller.abort());
      return new Promise(() => {});
    });
    await assert.rejects(
      h.api.verdicts.keyed({ threadIds: ["thread"] }, caller.signal),
    );
    assert.equal(reads, 1);
    await assert.rejects(
      h.api.verdicts.keyed({ threadIds: ["thread"] }, caller.signal),
    );
    assert.equal(reads, 1);
    h.api.verdicts.dispose();
    await assert.rejects(h.api.verdicts.keyed({ threadIds: ["thread"] }));
    assert.equal(reads, 1);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("failed publication remains visible in sanitized trigger diagnostics even with no metadata result", async () => {
  const h = await setup();
  try {
    h.enable();
    h.setWriteFailure(true);
    await h.engine.idle(h.idle());
    const read = await h.api.verdicts.keyed({ threadIds: ["thread"] });
    assert.equal(read.threads[0]?.summaries.length, 0);
    assert.equal(read.threads[0]?.publicationFailure, "metadata_write_failed");
    const log = await h.harness.behavior.runCli([
      "triggers",
      "log",
      "--thread",
      "thread",
      "--limit",
      "1",
      "--json",
    ]);
    assert.equal(log.exitCode, 0);
    const parsed = JSON.parse(log.stdout);
    assert.equal(parsed.attempts[0]?.publication, "failed");
    assert.equal(parsed.next, null);
    assert.ok(!log.stdout.includes("PRIVATE_METADATA_ERROR"));
    assert.ok(!log.stdout.includes("answers"));
  } finally {
    await h.harness.lifecycle.dispose();
  }
});

test("a disable during asynchronous keyed validation cannot return an old published summary", async (t) => {
  const h = await setup();
  try {
    h.enable();
    await h.engine.idle(h.idle());
    const current = h.api.models.isCurrent.bind(h.api.models);
    let changed = false;
    t.mock.method(
      h.api.models,
      "isCurrent",
      async (...args: Parameters<typeof current>) => {
        const result = await current(...args);
        if (!changed) {
          changed = true;
          queueMicrotask(() => h.triggers.enable("binding", false));
        }
        return result;
      },
    );
    const result = await h.api.verdicts.keyed({ threadIds: ["thread"] });
    assert.equal(changed, true);
    assert.equal(result.threads[0]?.summaries.length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
