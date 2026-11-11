import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { triggerHostOptions, setupTriggers } from "./trigger-fixtures.ts";
import { VerdictMetadataWriter } from "./verdict-writer.ts";
import {
  boundedMetadata,
  parseMetadata,
  type VerdictSummary,
} from "./verdict-metadata.ts";
import { idleEvent, snapshot } from "./trigger-events.ts";
import { Deadline } from "./deadline.ts";
const thread = makeThreadResponse({
  id: "thread",
  projectId: "project",
  environmentId: "exact-env",
  providerId: "codex",
  title: "Synthetic",
  status: "idle",
  updatedAt: 1000,
  archivedAt: null,
  deletedAt: null,
});
async function setup(fail = false) {
  const controls = triggerHostOptions(thread);
  const h = await setupTriggers(
    createFakePluginHost(controls.options),
    controls,
  );
  controls.setWriteFailure(fail);
  const trigger = h.enable();
  const run = await h.api.runner.run({
    id: "event-set",
    threadId: "thread",
    model: "private",
  });
  assert.equal(run.calibrated, true);
  h.repository.triggerAttempts.save({
    runId: run.runId,
    triggerId: "binding",
    event: "thread.idle",
    eventHash: "a".repeat(64),
    startedAt: run.startedAt,
    decision: "ran",
    publication: "none",
    code: null,
  });
  const scope = new Deadline({ deadlineAt: performance.now() + 5000 });
  const observed = await snapshot(
    h.bb.sdk,
    idleEvent({ thread, lastAssistantText: "Synthetic reply" }),
    scope,
  );
  scope.close();
  return {
    ...h,
    trigger,
    run,
    stamp: observed.snapshot,
    metadata: () => controls.metadata.get("thread") ?? {},
  };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(check(), "metadata operation settles");
}

test("only current calibrated references publish compact badges; disable clears them without erasing the run", async () => {
  const h = await setup();
  try {
    await h.publisher.publish(h.run, h.trigger, h.stamp);
    const published = parseMetadata(h.metadata());
    assert.equal(published.verdicts.summaries.length, 1);
    assert.deepEqual(published.verdicts.summaries[0]?.badges, [
      { outcome: "accepted", label: "Synthetic verdict" },
    ]);
    assert.equal(h.writes(), 1);
    assert.equal(
      h.repository.triggerAttempts.get(h.run.runId)?.publication,
      "published",
    );
    assert.ok(h.repository.publications.forThread("thread")[0]?.published);
    const encoded = JSON.stringify(h.metadata());
    assert.ok(!encoded.includes("answers"));
    assert.ok(!encoded.includes("dummy-runner-secret"));
    assert.ok(!encoded.includes("Synthetic reply"));
    h.triggers.enable("binding", false);
    await until(
      () => parseMetadata(h.metadata()).verdicts.summaries.length === 0,
    );
    assert.deepEqual(h.repository.getRun(h.run.runId), h.run);
    assert.deepEqual(h.repository.publications.forThread("thread"), []);
  } finally {
    h.publisher.dispose();
    h.triggers.dispose();
    await h.harness.lifecycle.dispose();
  }
});

test("publication failure is sanitized and recorded while the database run remains complete", async () => {
  const h = await setup(true);
  try {
    await h.publisher.publish(h.run, h.trigger, h.stamp);
    const attempt = h.repository.triggerAttempts.get(h.run.runId);
    assert.equal(attempt?.publication, "failed");
    assert.equal(attempt?.code, "metadata_write_failed");
    assert.ok(!JSON.stringify(attempt).includes("PRIVATE_METADATA_ERROR"));
    assert.equal(h.repository.getRun(h.run.runId)?.complete, true);
    assert.equal(
      h.repository.publications.forThread("thread")[0]?.published,
      false,
    );
  } finally {
    h.publisher.dispose();
    h.triggers.dispose();
    await h.harness.lifecycle.dispose();
  }
});

test("metadata caps and strict shapes exclude unknown data, duplicate sets and oversized summaries", () => {
  const summary: VerdictSummary = {
    runId: "r",
    setId: "s",
    setHash: "a".repeat(64),
    triggerId: "t",
    triggerRevision: "revision",
    timestamp: 1000,
    outcomes: { accepted: true },
    complete: true,
    calibrated: true,
    badges: [{ outcome: "accepted", label: "Label" }],
  };
  assert.equal(
    boundedMetadata(
      Array.from({ length: 21 }, (_, i) => ({
        ...summary,
        runId: `r${i}`,
        setId: `s${i}`,
        timestamp: 1000 + i,
      })),
    ).verdicts.summaries.length,
    20,
  );
  const large = Array.from({ length: 20 }, (_, i) => ({
    ...summary,
    runId: `r${i}`,
    setId: `s${i}`,
    outcomes: Object.fromEntries(
      Array.from({ length: 64 }, (_, n) => [
        `outcome${n}${"x".repeat(110)}`,
        true,
      ]),
    ),
    badges: Array.from({ length: 64 }, (_, n) => ({
      outcome: `outcome${n}${"x".repeat(110)}`,
      label: "x".repeat(64),
    })),
  }));
  const bounded = boundedMetadata(large);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 32768);
  assert.ok(bounded.verdicts.summaries.length < 20);
  assert.throws(() =>
    parseMetadata({ verdicts: { version: 1, summaries: [summary, summary] } }),
  );
  assert.throws(() =>
    parseMetadata({
      verdicts: { version: 1, summaries: [{ ...summary, answers: { q: 1 } }] },
    }),
  );
  assert.throws(() =>
    parseMetadata({ verdicts: { version: 1, summaries: [] }, state: "raw" }),
  );
});

test("abort-ignoring metadata mutations retain two global/per-thread slots without a write queue", async () => {
  let calls = 0;
  let getCalls = 0;
  const releases: ((value: unknown) => void)[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    sdk: {
      threads: {
        getPluginMetadata: async () => {
          getCalls++;
          return {};
        },
        updatePluginMetadata: async () => {
          calls++;
          return new Promise((resolve) => releases.push(resolve));
        },
      },
    },
  });
  const writer = new VerdictMetadataWriter(bb.sdk, () => {});
  const caller = new AbortController();
  const first = new Deadline({
    deadlineAt: performance.now() + 5000,
    signals: [caller.signal],
  });
  const second = new Deadline({ deadlineAt: performance.now() + 5000 });
  const extra = new Deadline({ deadlineAt: performance.now() + 5000 });
  const metadata = boundedMetadata([]);
  try {
    const a = writer.write("a", metadata, [], first);
    await until(() => calls === 1);
    caller.abort();
    await assert.rejects(a);
    assert.equal(writer.hasPending(), true);
    assert.equal(writer.busy("a"), true);
    const b = writer.write("b", metadata, [], second);
    await until(() => calls === 2);
    assert.equal(writer.busy(), true);
    await assert.rejects(writer.keys("c", extra));
    await assert.rejects(writer.write("c", metadata, [], extra));
    assert.equal(calls, 2);
    assert.equal(getCalls, 0);
    releases[0]!(metadata);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writer.busy(), false);
    releases[1]!(metadata);
    await b;
    assert.equal(writer.hasPending(), false);
  } finally {
    for (const release of releases) release(metadata);
    first.close();
    second.close();
    extra.close();
    await harness.lifecycle.dispose();
  }
});
