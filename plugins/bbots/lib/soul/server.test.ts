import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { createSchema } from "../setup/contracts.ts";
import { openSetup } from "../setup/storage.ts";
import { defaultsStateSchema, soulStateSchema } from "./contracts.ts";

const change = { author: "fixture-user", reason: "Explicit user instruction" };
function fixture(t: TestContext) {
  let current = createFakePluginHost({
    pluginId: "bbots",
    agentSkillIds: ["bbots", "bbots-soul"],
  });
  plugin(current.bb);
  t.after(() => current.harness.lifecycle.dispose());
  const store = openSetup(current.bb.storage);
  function bot(threadId?: string) {
    const setup = store.plan(
      createSchema.parse({ requestId: randomUUID(), hostId: "fixture-host" }),
    );
    if (threadId) {
      store.phase(setup.botId, "planned", "spawning");
      store.bind(setup.botId, threadId);
    }
    return setup.botId;
  }
  return {
    get harness() {
      return current.harness;
    },
    get db() {
      return current.bb.storage.database();
    },
    store,
    bot,
    async reload() {
      current = await current.harness.lifecycle.reload(plugin);
    },
  };
}

test("SOUL edits are revision checked, isolated, verbatim and start no model work", async (t) => {
  const f = fixture(t),
    botId = f.bot(),
    other = f.bot();
  const before = soulStateSchema.parse(
    await f.harness.behavior.callRpc("soulShow", { botId }),
  );
  assert.equal(before.current?.revision, 1);
  assert.equal(before.pending, "not-supplied");
  const markdown = "# Soul\n\nBe candid.\n";
  const input = { botId, expectedRevision: 1, markdown, ...change };
  const next = soulStateSchema.parse(
    await f.harness.behavior.callRpc("soulUpdate", input),
  );
  assert.equal(next.current?.markdown, markdown);
  assert.equal(next.current?.revision, 2);
  assert.equal(next.current?.author, change.author);
  assert.equal(next.appliedRevision, null);
  await assert.rejects(
    f.harness.behavior.callRpc("soulUpdate", input),
    /changed/,
  );
  for (const invalid of [" ", "x".repeat(16001)]) {
    await assert.rejects(
      f.harness.behavior.callRpc("soulUpdate", {
        ...input,
        expectedRevision: 2,
        markdown: invalid,
      }),
    );
  }
  assert.equal(f.store.documents.get(other, "SOUL.md")?.revision, 1);
  assert.equal(f.store.documents.revision(botId, "SOUL.md", 1).revision, 1);
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  await f.reload();
  assert.equal(
    soulStateSchema.parse(
      await f.harness.behavior.callRpc("soulShow", { botId }),
    ).current?.markdown,
    markdown,
  );
});

test("one configure callback selects only SQLite-owned threads and never claims application", async (t) => {
  const f = fixture(t),
    botId = f.bot("thr_owned");
  const ctx = makePluginAgentConfigurationContext();
  ctx.thread.id = "thr_foreign";
  const foreign = await f.harness.behavior.resolveAgentConfiguration({
    ...ctx,
    pluginMetadata: { botId },
  });
  assert.deepEqual(foreign.skills, []);
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS n FROM soul_supplied").get(),
    { n: 0 },
  );
  ctx.thread.id = "thr_owned";
  const first = await f.harness.behavior.resolveAgentConfiguration(ctx);
  assert.deepEqual(first.skills, ["bbots", "bbots-soul"]);
  assert.match(first.instructions ?? "", /role main/);
  assert.match(first.instructions ?? "", /SOUL.md revision 1/);
  let state = soulStateSchema.parse(
    await f.harness.behavior.callRpc("soulShow", { botId }),
  );
  assert.equal(state.lastSuppliedRevision, 1);
  assert.equal(state.pending, "unverified");
  assert.equal(state.appliedRevision, null);
  await f.harness.behavior.callRpc("soulUpdate", {
    botId,
    expectedRevision: 1,
    markdown: "New deliberate guidance.",
    ...change,
  });
  state = soulStateSchema.parse(
    await f.harness.behavior.callRpc("soulShow", { botId }),
  );
  assert.equal(state.pending, "newer-revision");
  assert.equal(state.lastSuppliedRevision, 1);
  assert.doesNotMatch(first.instructions ?? "", /New deliberate guidance/);
  const second = await f.harness.behavior.resolveAgentConfiguration(ctx);
  assert.match(second.instructions ?? "", /New deliberate guidance/);
  assert.equal(
    soulStateSchema.parse(
      await f.harness.behavior.callRpc("soulShow", { botId }),
    ).appliedRevision,
    null,
  );
  for (let i = 0; i < 10; i++)
    await f.harness.behavior.resolveAgentConfiguration(ctx);
  assert.deepEqual(
    f.db.prepare("SELECT COUNT(*) AS n FROM soul_supplied").get(),
    { n: 1 },
  );
  await f.reload();
  assert.equal(
    soulStateSchema.parse(
      await f.harness.behavior.callRpc("soulShow", { botId }),
    ).lastSuppliedRevision,
    2,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});

test("execution defaults inherit safely, reject fallback permission changes, and never mutate existing main", async (t) => {
  const f = fixture(t),
    botId = f.bot("thr_main"),
    other = f.bot();
  let state = defaultsStateSchema.parse(
    await f.harness.behavior.callRpc("defaultsShow", { botId }),
  );
  assert.deepEqual(state.defaults.main, {});
  assert.deepEqual(state.effectiveWorker, {});
  assert.equal(state.revision, 0);
  const defaults = {
    main: {
      providerId: "codex",
      model: "gpt-6.1-sol",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
    },
    worker: null,
    fallback: { providerId: "codex", model: "fallback" },
  };
  state = defaultsStateSchema.parse(
    await f.harness.behavior.callRpc("defaultsUpdate", {
      botId,
      expectedRevision: 0,
      defaults,
      ...change,
    }),
  );
  assert.deepEqual(state.effectiveWorker, defaults.main);
  assert.equal(state.automaticFallback, "disabled");
  assert.equal(state.scope, "future-conversations");
  await assert.rejects(
    f.harness.behavior.callRpc("defaultsUpdate", {
      botId,
      expectedRevision: 0,
      defaults,
      ...change,
    }),
    /changed/,
  );
  await assert.rejects(
    f.harness.behavior.callRpc("defaultsUpdate", {
      botId,
      expectedRevision: 1,
      defaults: { ...defaults, fallback: { permissionMode: "full" } },
      ...change,
    }),
  );
  assert.equal(
    defaultsStateSchema.parse(
      await f.harness.behavior.callRpc("defaultsShow", { botId: other }),
    ).revision,
    0,
  );
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
  await f.reload();
  assert.deepEqual(
    defaultsStateSchema.parse(
      await f.harness.behavior.callRpc("defaultsShow", { botId }),
    ).defaults,
    defaults,
  );
});

test("CLI handles deliberate editing, malformed defaults and current bounded brief without host I/O", async (t) => {
  const f = fixture(t),
    botId = f.bot();
  let response = await f.harness.behavior.runCli([
    "soul",
    "update",
    botId,
    "--revision",
    "1",
    "--markdown",
    "Speak plainly.",
    "--author",
    "fixture-user",
    "--reason",
    "Explicit instruction",
    "--json",
  ]);
  assert.equal(response.exitCode, 0);
  assert.equal(JSON.parse(response.stdout).current.revision, 2);
  response = await f.harness.behavior.runCli([
    "models",
    "update",
    botId,
    "--revision",
    "0",
    "--defaults",
    "invalid-json",
    "--author",
    "fixture-user",
    "--reason",
    "Explicit instruction",
    "--json",
  ]);
  assert.equal(response.exitCode, 1);
  assert.equal(JSON.parse(response.stdout).error.code, "invalid_defaults");
  response = await f.harness.behavior.runCli(["brief", botId, "--json"]);
  assert.equal(response.exitCode, 0);
  const brief = JSON.parse(response.stdout);
  assert.equal(brief.soul.currentRevision, 2);
  assert.equal(brief.soul.appliedRevision, null);
  assert.equal(brief.soul.current, undefined);
  assert.ok(brief.unavailable.includes("memory"));
  assert.equal(f.harness.inspection.sdk.calls.length, 0);
});
