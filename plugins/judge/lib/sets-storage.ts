import { persist, type Database } from "./persistence.ts";
import type { StoredSet } from "./results.ts";

export class DefinitionRepository {
  private db: Database;
  private invalidate: () => void;
  constructor(db: Database, invalidate: () => void) {
    this.db = db;
    this.invalidate = invalidate;
  }

  saveSet(record: StoredSet): void {
    persist(() =>
      this.db.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO question_sets(id, schema_version, scope, hash, yaml) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version, scope=excluded.scope, hash=excluded.hash, yaml=excluded.yaml",
          )
          .run(
            record.id,
            record.schemaVersion,
            record.scope,
            record.hash,
            record.yaml,
          );
        this.db
          .prepare("UPDATE triggers SET enabled = 0 WHERE set_id = ?")
          .run(record.id);
        this.invalidate();
      })(),
    );
  }

  getSet(id: string): StoredSet | null {
    return persist(() => {
      const row = this.db
        .prepare(
          "SELECT id, schema_version, scope, hash, yaml FROM question_sets WHERE id = ?",
        )
        .get(id) as
        | {
            id: string;
            schema_version: 1;
            scope: "global";
            hash: string;
            yaml: string;
          }
        | undefined;
      return row
        ? {
            id: row.id,
            schemaVersion: row.schema_version,
            scope: row.scope,
            hash: row.hash,
            yaml: row.yaml,
          }
        : null;
    });
  }

  pageSets(limit: number, after = ""): StoredSet[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101)
      throw new RangeError("invalid_pagination");
    return persist(() => {
      const rows = this.db
        .prepare(
          "SELECT id FROM question_sets WHERE id > ? ORDER BY id LIMIT ?",
        )
        .all(after, limit) as { id: string }[];
      return rows.map((row) => this.getSet(row.id)!);
    });
  }

  removeSet(id: string): void {
    persist(() =>
      this.db.transaction(() => {
        this.db.prepare("DELETE FROM question_sets WHERE id = ?").run(id);
        this.db
          .prepare("UPDATE triggers SET enabled = 0 WHERE set_id = ?")
          .run(id);
        this.invalidate();
      })(),
    );
  }

  projectEnabled(id: string): boolean {
    return persist(() => {
      const row = this.db
        .prepare("SELECT enabled FROM project_settings WHERE project_id = ?")
        .get(id) as { enabled: number } | undefined;
      return row ? row.enabled === 1 : true;
    });
  }

  setProjectEnabled(id: string, enabled: boolean): void {
    persist(() =>
      this.db.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO project_settings(project_id, enabled) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled",
          )
          .run(id, Number(enabled));
        this.db.prepare("UPDATE triggers SET enabled = 0").run();
        this.invalidate();
      })(),
    );
  }
}
