import assert from "node:assert/strict";
import { test } from "node:test";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { summarizeNative } from "./observation.ts";
import { fixture, context } from "./fixture.test.ts";

test("fresh/estimated/stale/missing/future snapshots never grant transition or dispatch authority", () => {
  const now = Date.now(),
    thread = makeThreadResponse({ id: "thr_main", status: "idle" });
  assert.equal(
    summarizeNative(thread, context(now - 1000), [], [], now).usage.status,
    "fresh",
  );
  const estimated = context(now - 1000);
  estimated.usage.snapshot.estimated = true;
  assert.equal(
    summarizeNative(thread, estimated, [], [], now).usage.status,
    "estimated",
  );
  assert.equal(
    summarizeNative(thread, context(now - 61000), [], [], now).usage.status,
    "stale",
  );
  assert.equal(
    summarizeNative(thread, context(now + 1000), [], [], now).usage.status,
    "stale",
  );
  const aggregate = summarizeNative(
    thread,
    {
      usage: { estimated: false, usedTokens: 1000, modelContextWindow: 200000 },
    },
    [],
    [],
    now,
  );
  assert.equal(aggregate.usage.status, "unavailable");
  assert.equal(aggregate.safeToExecuteTransition, false);
  assert.equal(aggregate.events.stopEvidence, "not-established");
  assert.equal(aggregate.automaticTransitions, "disabled");
});

test("new native clear or a different measured session invalidates a recent-looking usage snapshot", () => {
  const now = Date.now(),
    thread = makeThreadResponse({ id: "thr_main" });
  const base = {
    id: "event_fixture",
    threadId: thread.id,
    scope: { kind: "thread" as const },
    seq: 7,
    createdAt: now - 100,
  };
  const cleared = {
    ...base,
    type: "thread/context/cleared" as const,
    data: { providerThreadId: "provider_fixture" },
  };
  assert.equal(
    summarizeNative(thread, context(now - 1000), [cleared], [], now).usage
      .status,
    "stale",
  );
  const different = context(now - 500);
  different.usage.snapshot.providerSessionId = "session_changed";
  const usage = {
    ...base,
    type: "thread/contextWindowUsage/updated" as const,
    data: {
      providerThreadId: "provider_fixture",
      contextWindowUsage: different.usage,
    },
  };
  assert.equal(
    summarizeNative(thread, context(now - 1000), [usage], [], now).usage.status,
    "stale",
  );
});

test("an older previous-session usage event cannot invalidate a newer snapshot", () => {
  const now = Date.now(),
    thread = makeThreadResponse({ id: "thr_main" });
  const old = context(now - 2000);
  old.usage.snapshot.providerSessionId = "session_previous";
  const event = {
    id: "event_old",
    threadId: thread.id,
    scope: { kind: "thread" as const },
    seq: 1,
    createdAt: now - 2000,
    type: "thread/contextWindowUsage/updated" as const,
    data: {
      providerThreadId: "provider_previous",
      contextWindowUsage: old.usage,
    },
  };
  const observed = summarizeNative(
    thread,
    context(now - 1000),
    [event],
    [],
    now,
  );
  assert.equal(observed.usage.status, "fresh");
  assert.equal(observed.safeToExecuteTransition, false);
});

test("bounded native observations retain manual Stop and parentage without queue text or any native mutation", async (t) => {
  const f = fixture(t),
    now = Date.now();
  f.harness.sdk.stub("threads.events.list", () => [
    {
      id: "event_stop",
      threadId: "thr_worker",
      scope: { kind: "thread" },
      seq: 20,
      createdAt: now,
      type: "system/thread/interrupted",
      data: { reason: "manual-stop" },
    },
  ]);
  f.harness.sdk.stub("threads.queuedMessages.list", () =>
    Array.from({ length: 25 }, (_, i) => ({
      id: `queue_${i}`,
      content: [{ text: "Private queued draft fixture" }],
    })),
  );
  const observed = await f.continuity.readiness(
    f.bot.botId,
    f.worker.conversationId,
  );
  assert.equal(observed.events.stopEvidence, "manual-stop-observed");
  assert.equal(observed.queue.count, 25);
  assert.equal(observed.queue.ids.length, 20);
  assert.equal(observed.queue.complete, false);
  assert.equal(observed.parentThreadId, "thr_parent");
  assert.equal(observed.safeToExecuteTransition, false);
  assert.equal(
    JSON.stringify(observed).includes("Private queued draft"),
    false,
  );
  assert.deepEqual(
    f.harness.inspection.sdk.calls.map((call) => call.path).sort(),
    [
      "threads.context",
      "threads.events.list",
      "threads.get",
      "threads.queuedMessages.list",
    ],
  );
  const args = f.harness.inspection.sdk.callsTo(
    "threads.events.list",
  )[0]![0] as { limit: string; threadId: string };
  assert.equal(args.limit, "20");
  assert.equal(args.threadId, "thr_worker");
});
