import assert from "node:assert/strict";
import { test } from "node:test";
import { requestRemoval } from "./removal-request.ts";

test("environment removals use core only, retries cleanup, refusals propagate", async () => {
  const calls: string[] = [];
  const actions = {
    deleteEnvironment: async () => {
      calls.push("delete");
    },
    cleanupEnvironment: async () => {
      calls.push("cleanup");
    },
    removeOrphan: async () => {
      calls.push("host");
      return { status: "removed" } satisfies { status: "removed" };
    },
  };
  assert.deepEqual(await requestRemoval({ id: "e", failed: false }, actions), {
    status: "requested",
  });
  assert.deepEqual(await requestRemoval({ id: "e", failed: true }, actions), {
    status: "requested",
  });
  assert.deepEqual(calls, ["delete", "cleanup"]);
  assert.deepEqual(await requestRemoval(null, actions), { status: "removed" });
  assert.deepEqual(
    await requestRemoval(
      { id: "e", failed: false },
      {
        ...actions,
        deleteEnvironment: async () => {
          throw new Error("Threads still live");
        },
      },
    ),
    { status: "failed", message: "Threads still live" },
  );
});
