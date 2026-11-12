import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { openSetup } from "../setup/storage.ts";
import { openSoul } from "../soul/store.ts";
import { openMemory } from "../memory/store.ts";
import { creationSchema } from "../memory/contracts.ts";
import { openWork } from "../work/storage.ts";
import { workSchema } from "../work/contracts.ts";
import { createTaskSource } from "../tasks/source.ts";
import { openCommitments } from "../commitments/store.ts";
import { createCommitments } from "../commitments/service.ts";
import { openCheckpoints } from "../checkpoints/store.ts";
import { openContinuity } from "./store.ts";

export const attribution = {
  author: "fixture-user",
  reason: "Authorized-turn continuation preparation",
};
export function context(at = Date.now()) {
  return {
    usage: {
      estimated: false,
      usedTokens: 1000,
      modelContextWindow: 200000,
      snapshot: {
        capturedAt: new Date(at).toISOString(),
        autoCompactAtTokens: 180000,
        categories: [],
        contextWindowTokens: 200000,
        estimated: false,
        model: "fixture-model",
        providerSessionId: "session_fixture",
        providerTurnId: null,
        usedTokens: 1000,
      },
    },
  };
}
export function fixture(t: TestContext) {
  const { bb, harness } = createFakePluginHost({ pluginId: "bbots" });
  t.after(() => harness.lifecycle.dispose());
  const store = openSetup(bb.storage),
    lifecycle = new AbortController();
  const bot = store.plan({
    requestId: randomUUID(),
    name: "Bob",
    hostId: "host_fixture",
    associations: { mode: "none" },
  });
  const other = store.plan({
    requestId: randomUUID(),
    name: "Alice",
    hostId: "host_fixture",
    associations: { mode: "none" },
  });
  store.conversations.bindInitialThread(bot.conversationId, "thr_main");
  store.conversations.bindInitialThread(other.conversationId, "thr_other");
  const soul = openSoul(bb.storage, store, () => {}),
    memory = openMemory(bb.storage, store, () => {}),
    work = openWork(bb.storage, store);
  const worker = work.plan(
    workSchema.parse({
      requestId: randomUUID(),
      botId: bot.botId,
      title: "Investigate",
      projectId: "proj_worker",
      environmentId: "env_worker",
      parentThreadId: "thr_parent",
      agreement: {
        assignment: "Inspect and report",
        reportTo: { kind: "thread", threadId: "thr_monitor" },
      },
      ...attribution,
    }),
  );
  work.start(worker.conversationId);
  work.bind(worker.conversationId, "thr_worker");
  const tasks = createTaskSource(bb, store, lifecycle.signal, () => {}),
    commitments = openCommitments(bb.storage, store, () => {});
  const commitmentStatus = createCommitments(
      bb,
      commitments,
      tasks,
      lifecycle.signal,
    ),
    checkpoints = openCheckpoints(bb.storage, store, soul);
  const continuity = openContinuity(bb, {
    store,
    memory,
    work,
    tasks,
    commitments,
    commitmentStatus,
    checkpoints,
    lifecycle: lifecycle.signal,
  });
  harness.sdk.stub("threads.get", ({ threadId }) =>
    makeThreadResponse({
      id: threadId,
      environmentId: threadId === "thr_worker" ? "env_worker" : "env_main",
      projectId: "proj_fixture",
      status: "idle",
      runtime: { displayStatus: "idle" },
      parentThreadId: threadId === "thr_worker" ? "thr_parent" : null,
      parentNotifications: "off",
    }),
  );
  harness.sdk.stub("threads.context", () => context());
  harness.sdk.stub("threads.events.list", () => []);
  harness.sdk.stub("threads.queuedMessages.list", () => []);
  const request = (conversationId = bot.conversationId) => ({
    botId: bot.botId,
    conversationId,
    requestId: randomUUID(),
    ...attribution,
  });
  const note = (overrides: Record<string, unknown> = {}) =>
    memory.create(
      creationSchema.parse({
        botId: bot.botId,
        requestId: randomUUID(),
        kind: "knowledge",
        topic: "Fixture",
        markdown: "Scoped source evidence",
        basis: "fact",
        sources: ["artifact:original"],
        parents: [],
        ...attribution,
        ...overrides,
      }),
    );
  return {
    bb,
    harness,
    store,
    bot,
    other,
    worker,
    memory,
    soul,
    work,
    tasks,
    commitments,
    checkpoints,
    continuity,
    lifecycle,
    request,
    note,
  };
}
