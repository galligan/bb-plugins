// Test fixture: two independent connections contend for the same canonical name.
import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";
import { IdentityRegistry } from "./identity-registry.ts";
import { ProjectRegistry } from "./project-registry.ts";
import { HandleRegistry } from "./handles.ts";
import { RadioError } from "./errors.ts";

const { dbPath, stationId, actorId } = workerData as {
  dbPath: string;
  stationId: string;
  actorId: string;
};
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
const registry = new HandleRegistry(
  db,
  new IdentityRegistry(db, stationId),
  new ProjectRegistry(db),
);
parentPort!.once("message", () => {
  try {
    registry.assign("proj_one", actorId, "same--name", {
      kind: "actor",
      actorId,
    });
    parentPort!.postMessage({ result: "success" });
  } catch (error) {
    if (!(error instanceof RadioError) || error.code !== "conflict")
      throw error;
    parentPort!.postMessage({ result: "conflict" });
  } finally {
    db.close();
    parentPort!.close();
  }
});
parentPort!.postMessage({ ready: true });
