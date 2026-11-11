import { randomUUID } from "node:crypto";
import {
  triggerDefinitionSchema,
  triggerRecordSchema,
  type TriggerDefinition,
  type TriggerRecord,
} from "./triggers-contract.ts";
import { hashJson, canonicalJson, ValidationError } from "./json.ts";
import { idSchema } from "./contracts.ts";
import { persist, PersistenceError, type Database } from "./persistence.ts";

type Row = { id: string; set_id: string; enabled: number; config_json: string };
/** Enabled is authoritative in its existing column; every edit/toggle retires the revision. */
export class TriggerRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  private decode(row: Row): TriggerRecord {
    const stored = JSON.parse(row.config_json);
    const record = triggerRecordSchema.parse({
      ...stored,
      enabled: row.enabled === 1,
    });
    if (
      (row.enabled !== 0 && row.enabled !== 1) ||
      record.definition.id !== row.id ||
      record.definition.setId !== row.set_id ||
      record.hash !== hashJson(record.definition) ||
      canonicalJson(stored) !==
        canonicalJson({
          definition: record.definition,
          hash: record.hash,
          revision: record.revision,
        })
    )
      throw new PersistenceError();
    return record;
  }
  get(id: string): TriggerRecord | null {
    idSchema.parse(id);
    return persist(() => {
      const row = this.db
        .prepare(
          "SELECT id,set_id,enabled,config_json FROM triggers WHERE id = ?",
        )
        .get(id) as Row | undefined;
      return row ? this.decode(row) : null;
    });
  }
  page(limit: number, after = ""): TriggerRecord[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101)
      throw new ValidationError("invalid_pagination");
    return persist(() =>
      (
        this.db
          .prepare(
            "SELECT id,set_id,enabled,config_json FROM triggers WHERE id > ? ORDER BY id LIMIT ?",
          )
          .all(after, limit) as Row[]
      ).map((row) => this.decode(row)),
    );
  }
  enabled(event: "thread.idle" | "turn.failed"): TriggerRecord[] {
    // Global configuration cap bounds event admission work; filtering uses validated records.
    return persist(() => {
      const rows = this.db
        .prepare(
          "SELECT id,set_id,enabled,config_json FROM triggers ORDER BY id LIMIT 1001",
        )
        .all() as Row[];
      if (rows.length > 1000) throw new PersistenceError();
      return rows
        .map((row) => this.decode(row))
        .filter((row) => row.enabled && row.definition.event === event);
    });
  }
  save(value: TriggerDefinition): TriggerRecord {
    const definition = triggerDefinitionSchema.parse(value);
    const record = {
      definition,
      hash: hashJson(definition),
      revision: randomUUID(),
      enabled: false,
    };
    return persist(() =>
      this.db.transaction(() => {
        const existing = this.get(definition.id);
        if (
          !existing &&
          (
            this.db.prepare("SELECT COUNT(*) AS n FROM triggers").get() as {
              n: number;
            }
          ).n >= 1000
        )
          throw new PersistenceError();
        const { enabled: _enabled, ...stored } = record;
        this.db
          .prepare(
            "INSERT INTO triggers(id,set_id,enabled,config_json) VALUES (?,?,0,?) ON CONFLICT(id) DO UPDATE SET set_id=excluded.set_id,enabled=0,config_json=excluded.config_json",
          )
          .run(definition.id, definition.setId, JSON.stringify(stored));
        return record;
      })(),
    );
  }
  setEnabled(id: string, enabled: boolean): TriggerRecord {
    const previous = this.get(id);
    if (!previous) throw new ValidationError("missing_trigger");
    const record = { ...previous, enabled, revision: randomUUID() };
    const { enabled: _enabled, ...stored } = record;
    return persist(() => {
      this.db
        .prepare(
          "UPDATE triggers SET enabled = ?, config_json = ? WHERE id = ?",
        )
        .run(Number(enabled), JSON.stringify(stored), id);
      return record;
    });
  }
  remove(id: string): void {
    idSchema.parse(id);
    persist(() => {
      this.db.prepare("DELETE FROM triggers WHERE id = ?").run(id);
    });
  }
}
