import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createModelService } from "./models.ts";
import { openJudgeStorage } from "./storage.ts";
import { InferenceService } from "./inference.ts";

const questions = {
  q: { type: "noul", instructions: "Is the public fixture present?" },
};
const response = {
  model: "fixture-1",
  answers: { q: { type: "noul", noul: 0.9 } },
};
test("privacy refusal and missing configuration never dispatch; one allowed private fallback retains identities", async () => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: { typesafeApiKey: "dummy-only" },
  });
  try {
    const models = await createModelService(bb, openJudgeStorage(bb.storage));
    let calls = 0;
    const inference = new InferenceService(models, async () => {
      calls++;
      return Response.json(response);
    });
    const input = {
      questions,
      state: { text: "public fixture" },
      selection: { sensitive: true },
    };
    assert.equal((await inference.ask(input)).result.status, "unavailable");
    assert.equal(calls, 0);
    models.save({
      id: "public",
      model: "fixture-alias",
      connection: "typesafe",
    });
    models.setDefault("public");
    assert.equal((await inference.ask(input)).result.status, "unavailable");
    assert.equal(calls, 0);
    models.save({
      id: "private",
      model: "fixture-alias",
      connection: "typesafe",
      allowPrivate: true,
    });
    models.setDefault("private", true);
    const result = await inference.ask(input);
    assert.equal(result.result.status, "ran");
    assert.equal(calls, 1);
    assert.equal(result.requestedModel, "public");
    assert.equal(result.resolvedModel?.id, "private");
    assert.equal(result.fallbackReason, "private_not_allowed");
    assert.ok(!JSON.stringify(result).includes("dummy-only"));
    inference.dispose();
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("caller abort, disposal, expired budget and invalidation stop requests with sanitized reasons", async () => {
  for (const kind of [
    "preabort",
    "caller",
    "disposal",
    "budget",
    "rotate",
  ] as const) {
    const { bb, harness } = createFakePluginHost({
      pluginId: "judge",
      settings: { typesafeApiKey: "dummy-first" },
    });
    try {
      const models = await createModelService(bb, openJudgeStorage(bb.storage));
      models.save({ id: "model", model: "fixture", connection: "typesafe" });
      models.setDefault("model");
      const caller = new AbortController();
      let calls = 0;
      const inference = new InferenceService(models, async () => {
        calls++;
        if (kind === "caller")
          queueMicrotask(() => caller.abort("private reason"));
        if (kind === "disposal") queueMicrotask(() => inference.dispose());
        if (kind === "rotate")
          await harness.behavior.setSettings({
            typesafeApiKey: "dummy-second",
          });
        return new Promise<Response>(() => {});
      });
      if (kind === "preabort") caller.abort();
      const outcome = await inference.ask({
        questions,
        state: null,
        selection: { sensitive: false },
        signal: caller.signal,
        deadlineAt: performance.now() + (kind === "budget" ? -1 : 2000),
      });
      assert.equal(
        outcome.result.status === "unavailable" && outcome.result.reason,
        kind === "budget" ? "budget" : "cancelled",
      );
      assert.equal(calls, kind === "budget" || kind === "preabort" ? 0 : 1);
      assert.ok(!JSON.stringify(outcome).includes("private reason"));
      inference.dispose();
    } finally {
      await harness.lifecycle.dispose();
    }
  }
});

test("malformed arguments remain boundary validation failures rather than model outages", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    const models = await createModelService(bb, openJudgeStorage(bb.storage));
    const inference = new InferenceService(models, async () => {
      throw new Error("must not dispatch");
    });
    await assert.rejects(
      inference.ask({
        state: null,
        questions: { bad: { type: "image" } },
        selection: { sensitive: false },
      }),
    );
    inference.dispose();
  } finally {
    await harness.lifecycle.dispose();
  }
});
