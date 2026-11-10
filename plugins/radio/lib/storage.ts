import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Storage = Pick<BbPluginApi["storage"], "database" | "migrate">;

export interface RadioStore {
  readonly stationId: string;
}

// Statement positions and contents are immutable once shipped. Append only.
export const MIGRATIONS = [
  `CREATE TABLE station (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    id TEXT NOT NULL UNIQUE CHECK(length(id) > 0)
  ) STRICT`,
];

export function openRadioStorage(storage: Storage): RadioStore {
  const db = storage.database();
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
    return Object.freeze({ stationId: station.id });
  })();
}
