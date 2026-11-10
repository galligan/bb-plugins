import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openRadioStorage } from "./storage.ts";

test(
  "concurrent sends on independent SQLite connections return one immutable tx and snapshot",
  { timeout: 15_000 },
  async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
    const workers: Worker[] = [];
    try {
      const store = openRadioStorage(bb.storage);
      const project = store.projects.register("proj_one", "one").project;
      const actor = store.identities.createActor();
      store.handles.assign(project.id, actor.id, "worker", {
        kind: "actor",
        actorId: actor.id,
      });
      const dbPath = (
        bb.storage.database().pragma("database_list") as {
          name: string;
          file: string;
        }[]
      ).find(({ name }) => name === "main")!.file;
      const ready: Promise<void>[] = [];
      const results: Promise<{ id: string; replayed: boolean }>[] = [];
      const exits: Promise<void>[] = [];
      for (let index = 0; index < 2; index++) {
        const worker = new Worker(
          new URL("./transmission-replay.worker.ts", import.meta.url),
          {
            workerData: {
              dbPath,
              stationId: store.stationId,
              channelId: project.channelId,
              context: {
                authorId: actor.id,
                caller: { kind: "actor", actorId: actor.id },
                scope: { projectIds: [project.id] },
              },
            },
          },
        );
        workers.push(worker);
        ready.push(
          new Promise((resolve, reject) => {
            worker.once("message", () => resolve());
            worker.once("error", reject);
          }),
        );
        results.push(
          new Promise((resolve, reject) => {
            worker.on("message", (value) => {
              if (value.result) resolve(value.result);
            });
            worker.once("error", reject);
          }),
        );
        exits.push(
          new Promise((resolve, reject) => {
            worker.once("exit", (code) =>
              code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)),
            );
          }),
        );
      }
      await Promise.all(ready);
      for (const worker of workers) worker.postMessage("go");
      const outcomes = await Promise.all(results);
      await Promise.all(exits);
      assert.equal(outcomes[0]!.id, outcomes[1]!.id);
      assert.deepEqual(outcomes.map(({ replayed }) => replayed).sort(), [
        false,
        true,
      ]);
      assert.equal(
        bb.storage
          .database()
          .prepare<[], { n: number }>("SELECT count(*) AS n FROM transmissions")
          .get()!.n,
        1,
      );
      assert.equal(
        bb.storage
          .database()
          .prepare<[], { n: number }>(
            "SELECT count(*) AS n FROM transmission_recipients",
          )
          .get()!.n,
        1,
      );
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      await harness.lifecycle.dispose();
    }
  },
);
