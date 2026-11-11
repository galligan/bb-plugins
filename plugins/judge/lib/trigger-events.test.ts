import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import {
  idleEvent,
  failedEvent,
  snapshot,
  stillFresh,
} from "./trigger-events.ts";
import { Deadline } from "./deadline.ts";
import { SourceService } from "./sources/service.ts";

const thread = makeThreadResponse({
  id: "thread",
  projectId: "project",
  environmentId: "env",
  status: "idle",
  updatedAt: 1000,
  archivedAt: null,
  deletedAt: null,
});
const failed = {
  threadId: "thread",
  requestId: "request",
  turnId: null,
  attemptNumber: 1,
  inputAccepted: false,
  errorInfo: { message: "SYNTHETIC_PRIVATE_ERROR" },
  originPluginId: null,
  rateLimits: null,
};
const scope = () => new Deadline({ deadlineAt: performance.now() + 5000 });

test("idle adapter preserves latest null evidence and rechecks DTO/sequence without an output fallback", async () => {
  let current = thread;
  let sequence = 10;
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    sdk: {
      threads: {
        get: async () => current,
        output: async () => {
          throw new Error("must not read stale output");
        },
        events: {
          list: async () => [
            {
              threadId: "thread",
              seq: sequence,
              type: "turn/completed",
              data: {},
            },
          ],
        },
      },
    },
  });
  const deadline = scope();
  const sources = new SourceService(bb.sdk);
  try {
    const event = idleEvent({ thread, lastAssistantText: null });
    const initial = await snapshot(bb.sdk, event, deadline);
    assert.equal(initial.context.idle?.lastAssistantText, null);
    assert.equal(
      (
        await sources.read(
          { from: "thread.lastAssistantText" },
          {
            ...initial.context,
            signal: deadline.signal,
            deadlineAt: performance.now() + 5000,
          },
        )
      ).status,
      "unavailable",
    );
    assert.equal(
      await stillFresh(bb.sdk, event, initial.snapshot, deadline),
      true,
    );
    sequence++;
    assert.equal(
      await stillFresh(bb.sdk, event, initial.snapshot, deadline),
      false,
    );
    current = { ...thread, updatedAt: 1001 };
    await assert.rejects(stillFresh(bb.sdk, event, initial.snapshot, deadline));
    assert.ok(
      harness.inspection.sdk.calls.every(
        (call) => call.path !== "threads.output",
      ),
    );
  } finally {
    deadline.close();
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("failed adapter uses its own IDs/facts, binds the current request and never treats it as an idle payload", async () => {
  let requestId = "request";
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    sdk: {
      threads: {
        get: async () => ({ ...thread, status: "error" }),
        events: {
          list: async (args) => [
            {
              threadId: "thread",
              seq: 10,
              type: args?.types?.includes("client/turn/requested")
                ? "client/turn/requested"
                : "turn/failed",
              data: { requestId },
            },
          ],
        },
      },
    },
  });
  const deadline = scope();
  const sources = new SourceService(bb.sdk);
  try {
    const event = failedEvent(failed);
    const initial = await snapshot(bb.sdk, event, deadline);
    assert.equal(initial.context.idle, undefined);
    assert.equal(initial.context.event?.requestId, "request");
    assert.equal(initial.context.event?.error, "SYNTHETIC_PRIVATE_ERROR");
    const input = await sources.read(
      { from: "event.error" },
      { ...initial.context, signal: deadline.signal },
    );
    assert.equal(input.status === "ok" && input.sensitive, true);
    const publicId = await sources.read(
      { from: "event.inputAccepted" },
      { ...initial.context, signal: deadline.signal },
    );
    assert.equal(publicId.status === "ok" && publicId.value, false);
    requestId = "new-request";
    await assert.rejects(stillFresh(bb.sdk, event, initial.snapshot, deadline));
    assert.throws(() => idleEvent(failed));
    assert.throws(() => failedEvent({ thread, lastAssistantText: "fixture" }));
    assert.equal(
      failedEvent({ ...failed, errorInfo: null }).failure?.error,
      null,
    );
  } finally {
    deadline.close();
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("event snapshots fail closed for wrong threads, missing current request, changed state and expired budgets", async () => {
  for (const kind of ["wrong-thread", "no-request", "active", "budget"]) {
    let calls = 0;
    const { bb, harness } = createFakePluginHost({
      pluginId: "judge",
      sdk: {
        threads: {
          get: async () => {
            calls++;
            return {
              ...thread,
              id: kind === "wrong-thread" ? "other" : "thread",
              status: kind === "active" ? "active" : "error",
            };
          },
          events: { list: async () => [] },
        },
      },
    });
    const deadline = new Deadline({
      deadlineAt: performance.now() + (kind === "budget" ? -1 : 5000),
    });
    try {
      await assert.rejects(snapshot(bb.sdk, failedEvent(failed), deadline));
      assert.equal(calls, kind === "budget" ? 0 : 1);
    } finally {
      deadline.close();
      await harness.lifecycle.dispose();
    }
  }
});
