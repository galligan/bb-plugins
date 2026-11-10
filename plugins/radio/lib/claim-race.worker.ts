import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";
import { openRadioStorage } from "./storage.ts";
import { RadioError } from "./errors.ts";
const { dbPath, actorId, txId } = workerData as {
  dbPath: string;
  actorId: string;
  txId: string;
};
const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");
// The fixture has already applied all migrations on its owning connection.
const store = openRadioStorage({ database: () => db, migrate: () => {} });
parentPort!.once("message", () => {
  try {
    const result = store.commitments.act(
      {
        authorId: actorId,
        caller: { kind: "actor", actorId },
        scope: { projectIds: ["proj_one"] },
      },
      { kind: "wilco", txId, targetId: actorId, idempotencyKey: "claim" },
    );
    parentPort!.postMessage({
      result: { state: "accepted", actorId, id: result.commitment.id },
    });
  } catch (error) {
    if (!(error instanceof RadioError) || error.code !== "conflict")
      throw error;
    parentPort!.postMessage({ result: { state: "conflict", actorId } });
  } finally {
    db.close();
    parentPort!.close();
  }
});
parentPort!.postMessage({ ready: true });
