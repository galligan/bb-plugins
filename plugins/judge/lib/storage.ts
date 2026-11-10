import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { modelConfigSchema, type ModelConfig } from "./contracts.ts";
import { LIMITS } from "./json.ts";
import { parseVerdict, runSummarySchema, type Verdict } from "./results.ts";

type Storage = BbPluginApi["storage"];
type Database = ReturnType<Storage["database"]>;
type RunListOptions = {
  setId?: string;
  threadId?: string;
  limit?: number;
  before?: { startedAt: number; runId: string };
};

// Statement positions and contents become immutable once delivered.
export const MIGRATIONS = [
  `CREATE TABLE models (id TEXT PRIMARY KEY, config_json TEXT NOT NULL)`,
  `CREATE TABLE question_sets (id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL, scope TEXT NOT NULL CHECK(scope = 'global'), hash TEXT NOT NULL, yaml TEXT NOT NULL)`,
  `CREATE TABLE triggers (id TEXT PRIMARY KEY, set_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, config_json TEXT NOT NULL)`,
  `CREATE TABLE runs (id TEXT PRIMARY KEY, set_id TEXT, thread_id TEXT, started_at INTEGER NOT NULL, summary_json TEXT NOT NULL)`,
  `CREATE TABLE steps (run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, id TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(run_id, id))`,
  `CREATE INDEX runs_started_at ON runs(started_at, id)`,
  `CREATE TABLE cache (key TEXT PRIMARY KEY, created_at INTEGER NOT NULL, response_json TEXT NOT NULL)`,
  `CREATE TABLE project_settings (project_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL)`,
  `CREATE TABLE calibration_acceptance (set_id TEXT PRIMARY KEY, set_hash TEXT NOT NULL, fingerprints_json TEXT NOT NULL, test_run_id TEXT NOT NULL, accepted_at INTEGER NOT NULL)`,
  `ALTER TABLE steps ADD COLUMN ordinal INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE model_defaults (id INTEGER PRIMARY KEY CHECK(id = 1), default_id TEXT, private_id TEXT)`,
];

export class PersistenceError extends Error {
  constructor() {
    super("persistence_failed");
    this.name = "PersistenceError";
  }
}

function persist<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    throw new PersistenceError();
  }
}

export function openJudgeStorage(storage: Storage): JudgeRepository {
  return persist(() => {
    const db = storage.database();
    db.pragma("foreign_keys = ON");
    storage.migrate(db, MIGRATIONS);
    return new JudgeRepository(db);
  });
}

export class JudgeRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }

  saveModel(value: unknown): ModelConfig {
    const model = modelConfigSchema.parse(value);
    return persist(() => {
      this.db.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO models(id, config_json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET config_json = excluded.config_json",
          )
          .run(model.id, JSON.stringify(model));
        this.invalidateInference();
      })();
      return model;
    });
  }

  listModels(): ModelConfig[] {
    return persist(() =>
      this.db
        .prepare("SELECT config_json FROM models ORDER BY id LIMIT 1000")
        .all()
        .map((row) =>
          modelConfigSchema.parse(
            JSON.parse((row as { config_json: string }).config_json),
          ),
        ),
    );
  }

  getModel(id: string): ModelConfig | null {
    return persist(() => {
      const row = this.db
        .prepare("SELECT config_json FROM models WHERE id = ?")
        .get(id) as { config_json: string } | undefined;
      return row ? modelConfigSchema.parse(JSON.parse(row.config_json)) : null;
    });
  }

  pageModels(limit: number, after = ""): ModelConfig[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101)
      throw new RangeError("invalid_pagination");
    return persist(() =>
      this.db
        .prepare(
          "SELECT config_json FROM models WHERE id > ? ORDER BY id LIMIT ?",
        )
        .all(after, limit)
        .map((row) =>
          modelConfigSchema.parse(
            JSON.parse((row as { config_json: string }).config_json),
          ),
        ),
    );
  }

  removeModel(id: string): void {
    persist(() =>
      this.db.transaction(() => {
        this.db.prepare("DELETE FROM models WHERE id = ?").run(id);
        this.db
          .prepare(
            "UPDATE model_defaults SET default_id = CASE WHEN default_id = ? THEN NULL ELSE default_id END, private_id = CASE WHEN private_id = ? THEN NULL ELSE private_id END",
          )
          .run(id, id);
        this.invalidateInference();
      })(),
    );
  }

  getDefaults(): { defaultId: string | null; privateId: string | null } {
    return persist(() => {
      const row = this.db
        .prepare(
          "SELECT default_id, private_id FROM model_defaults WHERE id = 1",
        )
        .get() as
        { default_id: string | null; private_id: string | null } | undefined;
      return {
        defaultId: row?.default_id ?? null,
        privateId: row?.private_id ?? null,
      };
    });
  }

  setDefaults(value: {
    defaultId: string | null;
    privateId: string | null;
  }): void {
    persist(() =>
      this.db.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO model_defaults(id, default_id, private_id) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET default_id = excluded.default_id, private_id = excluded.private_id",
          )
          .run(value.defaultId, value.privateId);
        this.invalidateInference();
      })(),
    );
  }

  invalidateInference(): void {
    persist(() =>
      this.db.transaction(() => {
        this.db.exec("DELETE FROM cache; DELETE FROM calibration_acceptance");
      })(),
    );
  }

  saveRun(value: unknown, now = Date.now()): Verdict {
    const verdict = parseVerdict(value);
    return persist(() =>
      this.db.transaction(() => {
        const { steps, ...summary } = verdict;
        this.db
          .prepare(
            "INSERT INTO runs(id, set_id, thread_id, started_at, summary_json) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            verdict.runId,
            verdict.set?.id ?? null,
            verdict.threadId,
            verdict.startedAt,
            JSON.stringify(summary),
          );
        const insert = this.db.prepare(
          "INSERT INTO steps(run_id, id, result_json, ordinal) VALUES (?, ?, ?, ?)",
        );
        for (const [ordinal, [id, step]] of Object.entries(steps).entries())
          insert.run(verdict.runId, id, JSON.stringify(step), ordinal);
        this.pruneRuns(now);
        return verdict;
      })(),
    );
  }

  getRun(id: string): Verdict | null {
    return persist(() => {
      const row = this.db
        .prepare("SELECT summary_json FROM runs WHERE id = ?")
        .get(id) as { summary_json: string } | undefined;
      if (!row) return null;
      const rows = this.db
        .prepare(
          "SELECT id, result_json FROM steps WHERE run_id = ? ORDER BY ordinal, id",
        )
        .all(id) as { id: string; result_json: string }[];
      return parseVerdict({
        ...JSON.parse(row.summary_json),
        steps: Object.fromEntries(
          rows.map((s) => [s.id, JSON.parse(s.result_json)]),
        ),
      });
    });
  }

  listRuns(options: RunListOptions = {}): Verdict[] {
    return this.runRows(options).map((row) => this.getRun(row.id)!);
  }

  listRunSummaries(options: RunListOptions = {}) {
    return persist(() =>
      this.runRows(options).map((row) =>
        runSummarySchema.strip().parse(JSON.parse(row.summary_json)),
      ),
    );
  }

  private runRows(
    options: RunListOptions,
  ): { id: string; summary_json: string }[] {
    const { setId = null, threadId = null, limit = 20, before } = options;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (before &&
        (!Number.isSafeInteger(before.startedAt) ||
          before.startedAt < 0 ||
          typeof before.runId !== "string"))
    )
      throw new RangeError("invalid_pagination");
    return persist(() => {
      const timestamp = before?.startedAt ?? Number.MAX_SAFE_INTEGER;
      const rows = this.db
        .prepare(
          "SELECT id, summary_json FROM runs WHERE (? IS NULL OR set_id = ?) AND (? IS NULL OR thread_id = ?) AND (started_at < ? OR (started_at = ? AND id < ?)) ORDER BY started_at DESC, id DESC LIMIT ?",
        )
        .all(
          setId,
          setId,
          threadId,
          threadId,
          timestamp,
          timestamp,
          before?.runId ?? "",
          limit,
        ) as { id: string; summary_json: string }[];
      return rows;
    });
  }

  private pruneRuns(now: number): void {
    this.db
      .prepare("DELETE FROM runs WHERE started_at < ?")
      .run(now - LIMITS.runAgeMs);
    this.db
      .prepare(
        "DELETE FROM runs WHERE id IN (SELECT id FROM runs ORDER BY started_at DESC, id DESC LIMIT -1 OFFSET ?)",
      )
      .run(LIMITS.runs);
  }
}
