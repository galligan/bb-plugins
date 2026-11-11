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
  providerId: "codex",
  title: "Synthetic",
});
const row = <T>(seq: number, type: string, data: T) => ({
  id: `event-${seq}`,
  seq,
  type,
  data,
  threadId: "thread",
  createdAt: 1000 + seq,
  scope: { kind: "thread" as const },
});
const command = (seq: number, output = "Synthetic output") =>
  row(seq, "item/completed", {
    item: {
      type: "commandExecution",
      command: "echo fixture",
      status: "completed",
      exitCode: 0,
      durationMs: 10,
      aggregatedOutput: output,
    },
  });
const request = (seq: number, overrides: Record<string, unknown> = {}) =>
  row(seq, "client/turn/requested", {
    initiator: "user",
    senderThreadId: null,
    input: [{ type: "text", text: `Synthetic user ${seq}` }],
    ...overrides,
  });
function setup(events: unknown[]) {
  const host = createFakePluginHost({
    pluginId: "judge",
    sdk: {
      threads: {
        get: async () => thread,
        events: { list: async () => events },
      },
    },
  });
  return { ...host, sources: new SourceService(host.bb.sdk) };
}

test("bounded descending command paging preserves sequence, unknown exit status and upstream output truncation", async () => {
  const { sources, harness } = setup([]);
  try {
    const irrelevant = Array.from({ length: 100 }, (_, n) =>
      row(300 - n, "item/completed", { item: { type: "mcpToolCall" } }),
    );
    const old = command(199);
    const recent = command(200);
    recent.data.item = {
      ...recent.data.item,
      truncation: {
        aggregatedOutput: {
          originalLength: 10000,
          retainedHeadLength: 10,
          retainedTailLength: 10,
          truncatedAt: 0,
        },
      },
    } as typeof recent.data.item;
    harness.sdk.stub(
      "threads.events.list",
      async (input: { beforeSeq?: string }) =>
        input.beforeSeq === undefined ? irrelevant : [recent, old],
    );
    const result = await sources.read(
      { from: "thread.commandOutput", count: 2 },
      { threadId: "thread" },
    );
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    const values = result.value as {
      sequence: number;
      output: string;
      truncated: boolean;
    }[];
    assert.deepEqual(
      values.map((entry) => entry.sequence),
      [199, 200],
    );
    assert.equal(values[1]!.truncated, true);
    assert.equal(result.provenance.selection.truncated, true);
    assert.equal(result.provenance.sequence, 200);
    const calls = harness.inspection.sdk.callsTo("threads.events.list");
    assert.equal((calls[1]![0] as { beforeSeq: string }).beforeSeq, "201");
    assert.equal(calls.length, 2);
    assert.ok(!JSON.stringify(result.provenance).includes("echo fixture"));
    assert.ok(!JSON.stringify(result).includes("checksCurrent"));
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("provider variation and missing command output return unavailable rather than invented successful evidence", async () => {
  for (const item of [
    { type: "mcpToolCall", name: "exec_command" },
    { type: "toolCall", tool: "bash" },
    { type: "commandExecution", command: "fixture", status: "completed" },
  ]) {
    const { sources, harness } = setup([row(5, "item/completed", { item })]);
    try {
      const output = await sources.read(
        { from: "thread.commandOutput" },
        { threadId: "thread" },
      );
      assert.equal(output.status, "unavailable");
      if (item.type === "commandExecution") {
        const metadata = await sources.read(
          { from: "thread.commands" },
          { threadId: "thread" },
        );
        assert.equal(
          metadata.status === "ok" &&
            (metadata.value as { exitCode: number | null }[])[0]!.exitCode,
          null,
        );
      }
    } finally {
      sources.dispose();
      await harness.lifecycle.dispose();
    }
  }
});

test("recent user requests exclude system/plugin/agent/cross-thread/retry content and preserve chronological sequence", async () => {
  const events = [
    request(20, { initiator: "system" }),
    request(19, { originPluginId: "plugin" }),
    request(18, { initiator: "agent" }),
    request(17, { senderThreadId: "other" }),
    request(16, { retryOfRequestId: "old" }),
    request(15, { systemMessageKind: "child-completed" }),
    request(14, {
      input: [
        { type: "text", text: "Synthetic hidden", visibility: "agent-only" },
        { type: "text", text: "Synthetic visible" },
      ],
    }),
    request(13),
  ];
  const { sources, harness } = setup(events);
  try {
    const result = await sources.read(
      { from: "thread.recentUserMessages", count: 2 },
      { threadId: "thread" },
    );
    assert.equal(result.status, "ok");
    if (result.status !== "ok") return;
    assert.deepEqual(
      (result.value as { sequence: number }[]).map((entry) => entry.sequence),
      [13, 14],
    );
    assert.ok(!JSON.stringify(result.value).includes("Synthetic hidden"));
    assert.equal(result.sensitive, true);
    assert.equal(result.provenance.selection.count, 2);
    assert.equal(
      harness.inspection.sdk.callsTo("threads.promptHistory").length,
      0,
    );
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("unknown user origins, grouped or nontext requests fail closed, without provider-specific guessing", async () => {
  for (const data of [
    { input: [{ type: "text", text: "Synthetic" }], senderThreadId: null },
    {
      initiator: "user",
      senderThreadId: null,
      input: [{ type: "image", url: "unused" }],
    },
    {
      initiator: "user",
      senderThreadId: null,
      input: [{ type: "text", text: "Synthetic" }],
      inputGroups: [[], []],
    },
  ]) {
    const { sources, harness } = setup([row(1, "client/turn/requested", data)]);
    try {
      assert.equal(
        (
          await sources.read(
            { from: "thread.recentUserMessages" },
            { threadId: "thread" },
          )
        ).status,
        "unavailable",
      );
    } finally {
      sources.dispose();
      await harness.lifecycle.dispose();
    }
  }
});

test("latest goal clear prevents stale objective reuse; updates and historical beforeSeq snapshots preserve status", async () => {
  const updated = row(8, "thread/goal/updated", {
    objective: "Synthetic goal",
    status: "paused",
    tokenBudget: null,
    tokensUsed: 20,
    timeUsedSeconds: 1,
  });
  const cleared = row(9, "thread/goal/cleared", {
    threadId: "thread",
    providerThreadId: "provider",
  });
  const { sources, harness } = setup([cleared, updated]);
  try {
    assert.deepEqual(
      await sources.read({ from: "thread.goal" }, { threadId: "thread" }),
      {
        status: "unavailable",
        reason: "source_unavailable",
        code: "goal_cleared",
      },
    );
    harness.sdk.stub("threads.events.list", async () => [updated]);
    const result = await sources.read(
      { from: "thread.goal", beforeSeq: 9 },
      { threadId: "thread" },
    );
    assert.equal(
      result.status === "ok" && (result.value as { status: string }).status,
      "paused",
    );
    assert.equal(result.status === "ok" && result.provenance.sequence, 8);
    assert.equal(
      result.status === "ok" && result.provenance.selection.beforeSeq,
      9,
    );
    const call = harness.inspection.sdk
      .callsTo("threads.events.list")
      .at(-1)![0] as { types: string[] };
    assert.deepEqual(call.types, [
      "thread/goal/updated",
      "thread/goal/cleared",
    ]);
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("history order, exclusive bounds and scan caps are validated even beyond the selected first row", async () => {
  for (const events of [
    [command(1), command(2)],
    [command(2), command(2)],
    [command(3)],
  ]) {
    const { sources, harness } = setup(events);
    try {
      assert.equal(
        (
          await sources.read(
            { from: "thread.commands", count: 1, beforeSeq: 3 },
            { threadId: "thread" },
          )
        ).status,
        "unavailable",
      );
    } finally {
      sources.dispose();
      await harness.lifecycle.dispose();
    }
  }
  const { sources, harness } = setup([]);
  try {
    harness.sdk.stub(
      "threads.events.list",
      async (input: { beforeSeq?: string }) =>
        Array.from({ length: 100 }, (_, n) =>
          request(Number(input.beforeSeq ?? 1000) - n - 1, {
            initiator: "system",
          }),
        ),
    );
    const result = await sources.read(
      { from: "thread.recentUserMessages" },
      { threadId: "thread" },
    );
    assert.deepEqual(result, {
      status: "unavailable",
      reason: "source_unavailable",
      code: "history_window_exceeded",
    });
    assert.equal(
      harness.inspection.sdk.callsTo("threads.events.list").length,
      5,
    );
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});

test("an abort-ignoring history read cannot start another page after the run deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const { sources, harness } = setup([]);
  try {
    let release: (rows: unknown[]) => void = () => {};
    let calls = 0;
    let signal: AbortSignal | undefined;
    harness.sdk.stub("threads.events.list", async (args: unknown) => {
      calls++;
      signal = (args as { signal: AbortSignal }).signal;
      const pending = new Promise((resolve) => {
        release = resolve;
      });
      // Expire only after the first read starts, independently of host load.
      now = 21;
      t.mock.timers.tick(21);
      return pending;
    });
    const result = await sources.read(
      { from: "thread.recentUserMessages" },
      { threadId: "thread", deadlineAt: performance.now() + 20 },
    );
    assert.deepEqual(result, {
      status: "unavailable",
      reason: "budget",
      code: "budget",
    });
    assert.equal(signal?.aborted, true);
    release(
      Array.from({ length: 100 }, (_, n) =>
        request(200 - n, { initiator: "system" }),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
  } finally {
    sources.dispose();
    await harness.lifecycle.dispose();
  }
});
