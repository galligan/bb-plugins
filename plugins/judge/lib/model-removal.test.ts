import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import judge from "../server.ts";

test("public model removal clears only referring defaults and preserves unrelated models without inference or credential changes", async (t) => {
  let network = 0;
  t.mock.method(globalThis, "fetch", async () => {
    network++;
    throw new Error("offline network tripwire");
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "judge",
    settings: { typesafeApiKey: "dummy-removal-test-only" },
  });
  try {
    await judge(bb);
    for (const [id, allowPrivate] of [
      ["existing", false],
      ["temporary-public", false],
      ["temporary-private", true],
    ] as const)
      await harness.behavior.callRpc("models.add", {
        id,
        connection: "typesafe",
        model: "jev-1.13.0",
        allowPrivate,
      });
    await harness.behavior.callRpc("models.default", {
      id: "temporary-public",
    });
    await harness.behavior.callRpc("models.default", {
      id: "temporary-private",
      private: true,
    });
    assert.deepEqual(
      await harness.behavior.callRpc("models.remove", {
        id: "temporary-public",
      }),
      { removed: true },
    );
    const afterRpc = (await harness.behavior.callRpc("models.list", {})) as {
      models: { id: string }[];
      defaults: { defaultId: string | null; privateId: string | null };
    };
    assert.deepEqual(afterRpc.defaults, {
      defaultId: null,
      privateId: "temporary-private",
    });
    assert.deepEqual(
      afterRpc.models.map((model) => model.id),
      ["existing", "temporary-private"],
    );
    const removed = await harness.behavior.runCli([
      "models",
      "remove",
      "temporary-private",
      "--json",
    ]);
    assert.equal(removed.exitCode, 0);
    assert.deepEqual(JSON.parse(removed.stdout), { removed: true });
    const afterCli = await harness.behavior.callRpc("models.list", {});
    assert.deepEqual(afterCli, {
      models: afterRpc.models.filter((model) => model.id === "existing"),
      defaults: { defaultId: null, privateId: null },
      next: null,
    });
    assert.deepEqual(
      await harness.behavior.callRpc("models.remove", { id: "absent" }),
      { removed: true },
    );
    assert.equal(
      (
        (await harness.behavior.callRpc("models.check", {
          id: "existing",
        })) as { status: string }
      ).status,
      "configured",
    );
    assert.equal(network, 0);
    assert.equal(harness.inspection.sdk.calls.length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("removal surfaces expose help and reject malformed or broad deletion requests before mutating", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "judge" });
  try {
    await judge(bb);
    await harness.behavior.callRpc("models.add", {
      id: "keep",
      connection: "typesafe",
      model: "jev-1.13.0",
    });
    assert.equal(
      (await harness.behavior.runCli(["models", "remove", "--help"])).exitCode,
      0,
    );
    for (const input of [{}, { id: "../keep" }, { id: "keep", all: true }])
      await assert.rejects(harness.behavior.callRpc("models.remove", input));
    for (const args of [
      ["models", "remove", "--json"],
      ["models", "remove", "keep", "--all", "--json"],
      ["models", "remove", "../keep", "--json"],
    ])
      assert.equal((await harness.behavior.runCli(args)).exitCode, 1);
    const models = (await harness.behavior.callRpc("models.list", {})) as {
      models: { id: string }[];
    };
    assert.deepEqual(
      models.models.map((model) => model.id),
      ["keep"],
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
