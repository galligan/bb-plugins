import {
  triggerSnapshotSchema,
  type TriggerSnapshot,
} from "./trigger-events.ts";
import { canonicalJson } from "./json.ts";
import { idSchema } from "./contracts.ts";
import { summarySchema, type VerdictSummary } from "./verdict-metadata.ts";
import { persist, PersistenceError, type Database } from "./persistence.ts";
export type PublicationRef = {
  threadId: string;
  setId: string;
  triggerId: string;
  runId: string | null;
  summary: VerdictSummary;
  snapshot: TriggerSnapshot;
  published: boolean;
};
type Row = {
  thread_id: string;
  set_id: string;
  trigger_id: string;
  run_id: string | null;
  summary_json: string;
  snapshot_json: string;
  published: number;
};
export class PublicationRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  private decode(row: Row): PublicationRef {
    const summary = summarySchema.parse(JSON.parse(row.summary_json));
    const stamp = triggerSnapshotSchema.parse(JSON.parse(row.snapshot_json));
    if (
      stamp.thread.id !== row.thread_id ||
      canonicalJson(stamp) !== canonicalJson(JSON.parse(row.snapshot_json))
    )
      throw new PersistenceError();
    if (
      summary.setId !== row.set_id ||
      summary.triggerId !== row.trigger_id ||
      (row.run_id !== null && summary.runId !== row.run_id) ||
      (row.published !== 0 && row.published !== 1)
    )
      throw new PersistenceError();
    return {
      threadId: idSchema.parse(row.thread_id),
      setId: summary.setId,
      triggerId: summary.triggerId,
      runId: row.run_id,
      summary,
      snapshot: stamp,
      published: row.published === 1,
    };
  }
  forThread(threadId: string): PublicationRef[] {
    idSchema.parse(threadId);
    return persist(() => {
      const rows = this.db
        .prepare(
          "SELECT * FROM verdict_publications WHERE thread_id=? ORDER BY set_id LIMIT 21",
        )
        .all(threadId) as Row[];
      if (rows.length > 20) throw new PersistenceError();
      return rows.map((row) => this.decode(row));
    });
  }

  put(
    threadId: string,
    value: VerdictSummary,
    snapshot: TriggerSnapshot,
  ): void {
    idSchema.parse(threadId);
    const summary = summarySchema.parse(value);
    const stamp = triggerSnapshotSchema.parse(snapshot);
    if (stamp.thread.id !== threadId) throw new PersistenceError();
    persist(() =>
      this.db.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO verdict_publications(thread_id,set_id,trigger_id,run_id,summary_json,snapshot_json,published) VALUES (?,?,?,?,?,?,0) ON CONFLICT(thread_id,set_id) DO UPDATE SET trigger_id=excluded.trigger_id,run_id=excluded.run_id,summary_json=excluded.summary_json,snapshot_json=excluded.snapshot_json,published=0",
          )
          .run(
            threadId,
            summary.setId,
            summary.triggerId,
            summary.runId,
            JSON.stringify(summary),
            JSON.stringify(stamp),
          );
        this.db
          .prepare(
            "DELETE FROM verdict_publications WHERE rowid IN (SELECT rowid FROM verdict_publications WHERE thread_id=? ORDER BY json_extract(summary_json,'$.timestamp') DESC,set_id DESC LIMIT -1 OFFSET 20)",
          )
          .run(threadId);
        this.db.exec(
          "DELETE FROM verdict_publications WHERE rowid IN (SELECT rowid FROM verdict_publications ORDER BY json_extract(summary_json,'$.timestamp') DESC,thread_id DESC,set_id DESC LIMIT -1 OFFSET 10000)",
        );
      })(),
    );
  }
  acknowledge(threadId: string, runIds: string[]): void {
    persist(() =>
      this.db.transaction(() => {
        this.db
          .prepare(
            "UPDATE verdict_publications SET published=0 WHERE thread_id=?",
          )
          .run(threadId);
        const set = this.db.prepare(
          "UPDATE verdict_publications SET published=1 WHERE thread_id=? AND run_id=?",
        );
        for (const id of runIds) set.run(threadId, id);
      })(),
    );
  }
  invalidateThread(threadId: string): void {
    persist(() => {
      this.db
        .prepare(
          "UPDATE verdict_publications SET published=0,run_id=NULL WHERE thread_id=?",
        )
        .run(threadId);
    });
  }
  invalidateSet(threadId: string, setId: string): void {
    persist(() => {
      this.db
        .prepare(
          "UPDATE verdict_publications SET published=0,run_id=NULL WHERE thread_id=? AND set_id=?",
        )
        .run(threadId, setId);
    });
  }
  invalidateRun(threadId: string, setId: string, runId: string): void {
    persist(() => {
      this.db
        .prepare(
          "UPDATE verdict_publications SET published=0,run_id=NULL WHERE thread_id=? AND set_id=? AND json_extract(summary_json,'$.runId')=?",
        )
        .run(threadId, setId, runId);
    });
  }
  invalidateSets(setIds: string[]): void {
    persist(() =>
      this.db.transaction(() => {
        const update = this.db.prepare(
          "UPDATE verdict_publications SET published=0,run_id=NULL WHERE set_id=?",
        );
        for (const id of setIds) update.run(id);
      })(),
    );
  }
  invalidateTrigger(id: string): void {
    persist(() => {
      this.db
        .prepare(
          "UPDATE verdict_publications SET published=0,run_id=NULL WHERE trigger_id=?",
        )
        .run(id);
    });
  }
  invalidateAll(): void {
    persist(() => {
      this.db.exec("UPDATE verdict_publications SET published=0,run_id=NULL");
    });
  }
  removeUnselected(threadId: string, setIds: string[]): void {
    persist(() =>
      this.db.transaction(() => {
        for (const ref of this.forThread(threadId))
          if (!setIds.includes(ref.setId))
            this.db
              .prepare(
                "DELETE FROM verdict_publications WHERE thread_id=? AND set_id=?",
              )
              .run(threadId, ref.setId);
      })(),
    );
  }
  threads(after = "", limit = 100): string[] {
    return persist(() =>
      (
        this.db
          .prepare(
            "SELECT DISTINCT thread_id FROM verdict_publications WHERE thread_id>? ORDER BY thread_id LIMIT ?",
          )
          .all(after, limit) as { thread_id: string }[]
      ).map((row) => row.thread_id),
    );
  }
}
