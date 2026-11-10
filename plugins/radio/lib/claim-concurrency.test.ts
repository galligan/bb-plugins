import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { commitmentFixture } from "./commitment-fixture.ts";

test(
  "exclusive wilco on two independent SQLite connections has exactly one winner and replayable claim",
  { timeout: 15_000 },
  async () => {
    const host = createFakePluginHost({ pluginId: "radio" });
    const f = { ...host, ...commitmentFixture(host.bb) };
    const workers: Worker[] = [];
    try {
      const tx = f.store.transmissions.send(f.context, {
        ...f.input,
        idempotencyKey: "exclusive",
        requestMode: "exclusive",
      }).transmission;
      const dbPath = (
        f.bb.storage.database().pragma("database_list") as {
          name: string;
          file: string;
        }[]
      ).find(({ name }) => name === "main")!.file;
      const ready: Promise<void>[] = [];
      const results: Promise<{
        state: string;
        actorId: string;
        id?: string;
      }>[] = [];
      const exits: Promise<void>[] = [];
      for (const actorId of [f.author.id, f.target.id]) {
        const worker = new Worker(
          new URL("./claim-race.worker.ts", import.meta.url),
          { workerData: { dbPath, actorId, txId: tx.id } },
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
      assert.deepEqual(outcomes.map(({ state }) => state).sort(), [
        "accepted",
        "conflict",
      ]);
      const winner = outcomes.find(({ state }) => state === "accepted")!;
      const context = {
        authorId: winner.actorId,
        caller: { kind: "actor" as const, actorId: winner.actorId },
        scope: f.context.scope,
      };
      const replay = f.store.commitments.act(context, {
        kind: "wilco",
        txId: tx.id,
        targetId: winner.actorId,
        idempotencyKey: "claim",
      });
      assert.equal(replay.replayed, true);
      assert.equal(replay.commitment.id, winner.id);
      assert.equal(
        f.bb.storage
          .database()
          .prepare<[], { n: number }>("SELECT count(*) AS n FROM commitments")
          .get()!.n,
        1,
      );
      assert.equal(
        f.store.commitments.events(f.context.scope, { txId: tx.id }).items
          .length,
        1,
      );
      assert.deepEqual(
        f.store.transmissions.get(tx.id, f.context.scope).recipientIds,
        [],
      );
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      await f.harness.lifecycle.dispose();
    }
  },
);
