import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { SourceService } from "./service.ts";

const thread = makeThreadResponse({
  id: "thread",
  projectId: "project",
  title: "Synthetic title",
  providerId: "codex",
  status: "idle",
});
function setup() {
  const host = createFakePluginHost({
    pluginId: "judge",
    sdk: {
      threads: {
        get: async () => thread,
        output: async () => ({ output: "Synthetic fresh reply" }),
        defaultExecutionOptions: async () => ({ model: "configured-model" }),
      },
      projects: {
        get: async () => ({ id: "project", name: "Synthetic project" }),
      },
    },
  });
  const sources = new SourceService(host.bb.sdk);
  return { ...host, sources };
}

test("idle null is absent evidence, never a fallback to an older reply; ordinary idle-state output works", async () => {
  const { sources, harness } = setup();
  try {
    assert.deepEqual(
      await sources.read(
        { from: "thread.lastAssistantText" },
        { threadId: "thread", idle: { lastAssistantText: null } },
      ),
      {
        status: "unavailable",
        reason: "source_unavailable",
        code: "assistant_text_missing",
      },
    );
    assert.equal(harness.inspection.sdk.callsTo("threads.output").length, 0);
    const payload = await sources.read(
      { from: "thread.lastAssistantText" },
      {
        threadId: "thread",
        idle: { lastAssistantText: "Synthetic idle payload" },
      },
    );
    assert.equal(
      payload.status === "ok" && payload.value,
      "Synthetic idle payload",
    );
    assert.equal(harness.inspection.sdk.callsTo("threads.output").length, 0);
    const ordinary = await sources.read(
      { from: "thread.lastAssistantText" },
      { threadId: "thread" },
    );
    assert.equal(
      ordinary.status === "ok" && ordinary.value,
      "Synthetic fresh reply",
    );
    assert.equal(ordinary.status === "ok" && ordinary.sensitive, true);
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("free text and arbitrary models/providers stay sensitive; known provider and allowlisted event identifiers may be public", async () => {
  const { sources, harness } = setup();
  try {
    for (const from of ["thread.title", "project.name", "provider.model"]) {
      const result = await sources.read({ from }, { threadId: "thread" });
      assert.equal(result.status, "ok");
      assert.equal(result.status === "ok" && result.sensitive, true);
    }
    const provider = await sources.read(
      { from: "provider.id" },
      { threadId: "thread" },
    );
    assert.equal(provider.status === "ok" && provider.sensitive, false);
    harness.sdk.stub("threads.get", async () => ({
      ...thread,
      providerId: "custom-private-provider",
    }));
    const custom = await sources.read(
      { from: "provider.id" },
      { threadId: "thread" },
    );
    assert.equal(custom.status === "ok" && custom.sensitive, true);
    const event = {
      kind: "turn.failed" as const,
      threadId: "thread",
      projectId: "project",
      requestId: "request",
      error: "Synthetic error",
    };
    const id = await sources.read({ from: "event.requestId" }, { event });
    assert.equal(id.status === "ok" && id.sensitive, false);
    const error = await sources.read({ from: "event.error" }, { event });
    assert.equal(error.status === "ok" && error.sensitive, true);
    assert.deepEqual(await sources.read({ from: "event.turnId" }, { event }), {
      status: "unavailable",
      reason: "source_unavailable",
      code: "event_field_missing",
    });
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("byte and Unicode character limits refuse whole evidence without clipping or raw diagnostics", async () => {
  const { sources, harness } = setup();
  try {
    harness.sdk.stub("threads.output", async () => ({ output: "💡💡" }));
    const exact = await sources.read(
      { from: "thread.lastAssistantText", maxChars: 2 },
      { threadId: "thread" },
    );
    assert.equal(exact.status === "ok" && exact.value, "💡💡");
    const small = await sources.read(
      { from: "thread.lastAssistantText", maxChars: 1 },
      { threadId: "thread" },
    );
    assert.deepEqual(small, {
      status: "unavailable",
      reason: "too_large",
      code: "source_characters",
    });
    harness.sdk.stub("threads.output", async () => ({
      output: "x".repeat(65537),
    }));
    assert.equal(
      (
        await sources.read(
          { from: "thread.lastAssistantText" },
          { threadId: "thread" },
        )
      ).status,
      "unavailable",
    );
    harness.sdk.stub("threads.output", async () => {
      throw new Error("private-upstream-fixture");
    });
    const failed = await sources.read(
      { from: "thread.lastAssistantText" },
      { threadId: "thread" },
    );
    assert.ok(!JSON.stringify(failed).includes("private-upstream"));
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("missing context/DTO fields and unknown definitions remain explicit failures, without guessed values", async () => {
  const { sources, harness } = setup();
  try {
    assert.deepEqual(await sources.read({ from: "thread.title" }, {}), {
      status: "unavailable",
      reason: "source_unavailable",
      code: "thread_required",
    });
    harness.sdk.stub("threads.get", async () => ({ ...thread, title: null }));
    assert.equal(
      (await sources.read({ from: "thread.title" }, { threadId: "thread" }))
        .status,
      "unavailable",
    );
    harness.sdk.stub("threads.defaultExecutionOptions", async () => null);
    assert.equal(
      (await sources.read({ from: "provider.model" }, { threadId: "thread" }))
        .status,
      "unavailable",
    );
    assert.equal(
      (
        await sources.read(
          { from: "thread.title" },
          { threadId: "thread", projectId: "other" },
        )
      ).status,
      "unavailable",
    );
    assert.equal(
      (
        await sources.read(
          { from: "project.name" },
          { threadId: "thread", projectId: "other" },
        )
      ).status,
      "unavailable",
    );
    await assert.rejects(sources.read({ from: "event.arbitrary" }, {}));
    await assert.rejects(
      sources.read(
        { from: "thread.title", notPrivate: true },
        { threadId: "thread" },
      ),
    );
    const event = {
      kind: "thread.idle" as const,
      threadId: "thread",
      projectId: "project",
    };
    assert.equal(
      (
        await sources.read(
          { from: "event.threadId" },
          { threadId: "other", event },
        )
      ).status,
      "unavailable",
    );
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("source cancellation/disposal and whole budgets bound stalled SDK calls and prevent late follow-up reads", async () => {
  for (const kind of ["preabort", "caller", "dispose", "budget"] as const) {
    const { sources, harness } = setup();
    try {
      const caller = new AbortController();
      let release: (value: unknown) => void = () => {};
      let signal: AbortSignal | undefined;
      harness.sdk.stub(
        "threads.get",
        async (args: { signal?: AbortSignal }) => {
          signal = args.signal;
          if (kind === "caller") queueMicrotask(() => caller.abort());
          if (kind === "dispose") queueMicrotask(() => sources.dispose());
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      );
      if (kind === "preabort") caller.abort();
      const result = await sources.read(
        { from: "provider.model" },
        {
          threadId: "thread",
          signal: caller.signal,
          deadlineAt: performance.now() + (kind === "budget" ? 20 : 1000),
        },
      );
      assert.deepEqual(result, {
        status: "unavailable",
        reason: kind === "budget" ? "budget" : "cancelled",
        code: kind === "budget" ? "budget" : "cancelled",
      });
      if (kind !== "preabort") assert.equal(signal?.aborted, true);
      release(thread);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(
        harness.inspection.sdk.callsTo("threads.defaultExecutionOptions")
          .length,
        0,
      );
    } finally {
      sources.dispose();
      await harness.lifecycle.dispose();
    }
  }
});
