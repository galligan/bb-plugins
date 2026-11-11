import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { hashSchema } from "./results.ts";
import { triggerEventSchema } from "./triggers-contract.ts";
import { persist, PersistenceError, type Database } from "./persistence.ts";
export const triggerAttemptSchema = z.strictObject({
  runId: idSchema,
  triggerId: idSchema,
  event: triggerEventSchema,
  eventHash: hashSchema,
  startedAt: z.number().int().nonnegative(),
  decision: z.enum([
    "ran",
    "busy",
    "duplicate",
    "not_applicable",
    "unavailable",
  ]),
  publication: z.enum(["none", "published", "cleared", "failed", "stale"]),
  code: idSchema.nullable(),
});
export type TriggerAttempt = z.infer<typeof triggerAttemptSchema>;
export const attemptPageSchema = z.strictObject({
  triggerId: idSchema.optional(),
  threadId: idSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  before: z
    .strictObject({
      startedAt: z.number().int().nonnegative(),
      runId: idSchema,
    })
    .optional(),
});
export class TriggerAttempts {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  save(value: TriggerAttempt): TriggerAttempt {
    const attempt = triggerAttemptSchema.parse(value);
    return persist(() => {
      const run = this.db
        .prepare("SELECT started_at FROM runs WHERE id=?")
        .get(attempt.runId) as { started_at: number } | undefined;
      if (run?.started_at !== attempt.startedAt) throw new PersistenceError();
      this.db
        .prepare(
          "INSERT INTO trigger_attempts(run_id,trigger_id,record_json) VALUES (?,?,?)",
        )
        .run(attempt.runId, attempt.triggerId, JSON.stringify(attempt));
      return attempt;
    });
  }
  get(runId: string): TriggerAttempt | null {
    return persist(() => {
      const row = this.db
        .prepare(
          "SELECT a.run_id,a.trigger_id,a.record_json,r.started_at FROM trigger_attempts a JOIN runs r ON r.id=a.run_id WHERE a.run_id=?",
        )
        .get(runId) as
        | {
            run_id: string;
            trigger_id: string;
            record_json: string;
            started_at: number;
          }
        | undefined;
      if (!row) return null;
      const parsed = triggerAttemptSchema.parse(JSON.parse(row.record_json));
      if (
        parsed.runId !== row.run_id ||
        parsed.triggerId !== row.trigger_id ||
        parsed.startedAt !== row.started_at
      )
        throw new PersistenceError();
      return parsed;
    });
  }
  publication(
    runId: string,
    publication: TriggerAttempt["publication"],
    code: string | null,
  ): void {
    const previous = this.get(runId);
    if (!previous) throw new PersistenceError();
    const next = triggerAttemptSchema.parse({ ...previous, publication, code });
    persist(() => {
      this.db
        .prepare("UPDATE trigger_attempts SET record_json=? WHERE run_id=?")
        .run(JSON.stringify(next), runId);
    });
  }
  list(value: unknown) {
    const input = attemptPageSchema.parse(value);
    return persist(() => {
      const before = input.before?.startedAt ?? Number.MAX_SAFE_INTEGER;
      const rows = this.db
        .prepare(
          "SELECT a.run_id FROM trigger_attempts a JOIN runs r ON r.id=a.run_id WHERE (? IS NULL OR a.trigger_id=?) AND (? IS NULL OR r.thread_id=?) AND (r.started_at<? OR (r.started_at=? AND r.id<?)) ORDER BY r.started_at DESC,r.id DESC LIMIT ?",
        )
        .all(
          input.triggerId ?? null,
          input.triggerId ?? null,
          input.threadId ?? null,
          input.threadId ?? null,
          before,
          before,
          input.before?.runId ?? "",
          input.limit + 1,
        ) as { run_id: string }[];
      const attempts = rows
        .slice(0, input.limit)
        .map((row) => this.get(row.run_id)!);
      const last = attempts.at(-1);
      return {
        attempts,
        next:
          rows.length > input.limit && last
            ? { startedAt: last.startedAt, runId: last.runId }
            : null,
      };
    });
  }
}
