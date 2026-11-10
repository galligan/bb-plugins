import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createFakePluginHost,
  makeHostResponse,
} from "@get-bb/plugin-sdk/testing";
import wtPlugin, { rpcContract } from "../server.ts";

test("overview names personal projects and rescues includes their source checkout", async (t) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "wt",
    sdk: {
      hosts: {
        list: () => [
          makeHostResponse({
            id: "h",
            name: "Rescue Mac",
            status: "connected",
          }),
        ],
      },
      environments: { list: () => [] },
      projects: {
        list: (input) =>
          input?.includePersonal
            ? [
                {
                  id: "personal",
                  name: "Personal",
                  sources: [
                    { type: "local_path", hostId: "h", path: "/personal" },
                  ],
                },
              ]
            : [],
      },
    },
    experimental_callHostRpc: ({ method }) =>
      method === "list"
        ? { worktrees: [] }
        : {
            sources: [
              {
                sourcePath: "/personal",
                refs: [
                  {
                    ref: "refs/wt-rescue/a",
                    commit: "abc",
                    createdAt: 1,
                    subject: "rescued",
                  },
                ],
                error: null,
              },
            ],
          },
  });
  t.after(() => harness.lifecycle.dispose());
  await wtPlugin(bb);
  const overview = rpcContract.overview.output.parse(
    await harness.behavior.callRpc("overview", {}),
  );
  assert.deepEqual(overview.projects, [{ id: "personal", name: "Personal" }]);
  assert.equal(overview.machines[0]?.name, "Rescue Mac");
  const rescues = rpcContract.rescues.output.parse(
    await harness.behavior.callRpc("rescues", {}),
  );
  assert.equal(rescues.projects[0]?.projectId, "personal");
  assert.equal(rescues.projects[0]?.refs.length, 1);
});

test("a retained destroyed environment still routes removal through core", async (t) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "wt",
    sdk: {
      environments: {
        list: () => [
          {
            id: "e",
            hostId: "h",
            environmentProviderInstanceKey: "k",
            status: "destroyed",
            lifecycle: { teardown: null },
          },
        ],
        delete: () => ({ ok: true }),
      },
    },
    experimental_callHostRpc: () => {
      throw new Error("Must not bypass core");
    },
  });
  t.after(() => harness.lifecycle.dispose());
  await wtPlugin(bb);
  assert.deepEqual(
    await harness.behavior.callRpc("removeWorktree", {
      hostId: "h",
      pathKey: "k",
    }),
    { status: "requested" },
  );
  assert.equal(harness.inspection.sdk.callsTo("environments.delete").length, 1);
  assert.equal(harness.experimental_hostRpcCalls.length, 0);
});
