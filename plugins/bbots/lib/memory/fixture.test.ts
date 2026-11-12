import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openSetup } from "../setup/storage.ts";
import { creationSchema } from "./contracts.ts";
import { openMemory } from "./store.ts";

export function fixture(t: TestContext) {
  const { bb, harness } = createFakePluginHost({ pluginId: "bbots" });
  const setup = openSetup(bb.storage);
  const bot = setup.plan({
    requestId: randomUUID(),
    hostId: "host_fixture",
    name: "Bob",
    associations: { mode: "none" },
  });
  const other = setup.plan({
    requestId: randomUUID(),
    hostId: "host_fixture",
    name: "Alice",
    associations: { mode: "none" },
  });
  const memory = openMemory(bb.storage, setup, () => {});
  t.after(() => harness.lifecycle.dispose());
  function input(overrides: Record<string, unknown> = {}) {
    return creationSchema.parse({
      botId: bot.botId,
      requestId: randomUUID(),
      kind: "knowledge",
      topic: "Preference",
      markdown: "Prefer concise evidence.",
      basis: "fact",
      sources: ["thread:original#msg=1"],
      parents: [],
      author: "fixture-user",
      reason: "Explicit remember request",
      ...overrides,
    });
  }
  return {
    bb,
    harness,
    setup,
    bot,
    other,
    memory,
    input,
    db: bb.storage.database(),
  };
}
