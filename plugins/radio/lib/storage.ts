import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { IdentityRegistry } from "./identity-registry.ts";
import { ProjectRegistry } from "./project-registry.ts";
import { HandleRegistry } from "./handles.ts";
import { Transmissions } from "./transmissions.ts";
import { MIGRATIONS } from "./migrations.ts";
export { MIGRATIONS } from "./migrations.ts";

type Storage = Pick<BbPluginApi["storage"], "database" | "migrate">;

export interface RadioStore {
  readonly stationId: string;
  readonly identities: IdentityRegistry;
  readonly projects: ProjectRegistry;
  readonly handles: HandleRegistry;
  readonly transmissions: Transmissions;
}

export function openRadioStorage(storage: Storage): RadioStore {
  const db = storage.database();
  db.pragma("foreign_keys = ON");
  storage.migrate(db, MIGRATIONS);

  // First load and retries share one identity, including simultaneous loaders.
  return db.transaction(() => {
    db.prepare(
      "INSERT INTO station(singleton, id) VALUES (1, ?) ON CONFLICT(singleton) DO NOTHING",
    ).run(`station_${randomUUID()}`);
    const station = db
      .prepare<[], { id: string }>("SELECT id FROM station WHERE singleton = 1")
      .get();
    if (!station) throw new Error("Radio station initialization failed");
    const identities = new IdentityRegistry(db, station.id);
    const projects = new ProjectRegistry(db);
    const domain = {
      stationId: station.id,
      identities,
      projects,
      handles: new HandleRegistry(db, identities, projects),
    };
    return Object.freeze({
      ...domain,
      transmissions: new Transmissions(db, domain),
    });
  })();
}
