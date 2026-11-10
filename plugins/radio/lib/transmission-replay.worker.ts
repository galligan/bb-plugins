// Test fixture: independent SQLite connections replay the same send concurrently.
import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";
import { IdentityRegistry } from "./identity-registry.ts";
import { ProjectRegistry } from "./project-registry.ts";
import { HandleRegistry } from "./handles.ts";
import { Transmissions } from "./transmissions.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";

const { dbPath, stationId, context, channelId } = workerData as {
  dbPath: string;
  stationId: string;
  context: TransmissionContext;
  channelId: string;
};
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
const identities = new IdentityRegistry(db, stationId);
const projects = new ProjectRegistry(db);
const transmissions = new Transmissions(db, {
  stationId,
  identities,
  projects,
  handles: new HandleRegistry(db, identities, projects),
});
parentPort!.once("message", () => {
  try {
    const result = transmissions.send(context, {
      channelId,
      body: "@worker ready",
      idempotencyKey: "concurrent",
    });
    parentPort!.postMessage({
      result: { id: result.transmission.id, replayed: result.replayed },
    });
  } finally {
    db.close();
    parentPort!.close();
  }
});
parentPort!.postMessage({ ready: true });
