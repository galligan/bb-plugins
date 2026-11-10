import {
  calibrationSchema,
  parseEvaluationReport,
  type EvaluationReport,
} from "./evaluation-contract.ts";
import { idSchema } from "./contracts.ts";
import { persist, PersistenceError, type Database } from "./persistence.ts";
import type { CalibrationAcceptance } from "./results.ts";
import { LIMITS } from "./json.ts";

function matchesEvidence(
  report: EvaluationReport | null,
  setId: string,
  accepted: CalibrationAcceptance,
): boolean {
  if (
    !report?.complete ||
    report.stale ||
    report.set.id !== setId ||
    report.set.hash !== accepted.setHash ||
    accepted.acceptedAt < report.endedAt
  )
    return false;
  const fingerprints = new Set(
    report.variants[0]!.identities.map((identity) => identity.fingerprint),
  );
  return (
    fingerprints.size > 0 &&
    fingerprints.size === accepted.modelFingerprints.length &&
    accepted.modelFingerprints.every((fingerprint) =>
      fingerprints.has(fingerprint),
    )
  );
}

/** Reports contain only outcome/model diagnostics; state and raw answers stay out. */
export class EvaluationRepository {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  saveReport(value: unknown, now = Date.now()): EvaluationReport {
    const report = parseEvaluationReport(value);
    return persist(() =>
      this.db.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO evaluation_reports(id, set_id, created_at, report_json) VALUES (?, ?, ?, ?)",
          )
          .run(
            report.id,
            report.set.id,
            report.startedAt,
            JSON.stringify(report),
          );
        this.db
          .prepare("DELETE FROM evaluation_reports WHERE created_at < ?")
          .run(now - LIMITS.runAgeMs);
        this.db
          .prepare(
            "DELETE FROM evaluation_reports WHERE id IN (SELECT id FROM evaluation_reports ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET 1000)",
          )
          .run();
        // Expired evidence cannot keep a calibration acceptance alive.
        this.db.exec(
          "DELETE FROM calibration_acceptance WHERE test_run_id NOT IN (SELECT id FROM evaluation_reports)",
        );
        return report;
      })(),
    );
  }
  getReport(id: string): EvaluationReport | null {
    idSchema.parse(id);
    return persist(() => {
      const row = this.db
        .prepare(
          "SELECT id, set_id, created_at, report_json FROM evaluation_reports WHERE id = ?",
        )
        .get(id) as
        | {
            id: string;
            set_id: string;
            created_at: number;
            report_json: string;
          }
        | undefined;
      if (!row) return null;
      const report = parseEvaluationReport(JSON.parse(row.report_json));
      if (
        report.id !== row.id ||
        report.set.id !== row.set_id ||
        report.startedAt !== row.created_at
      )
        throw new PersistenceError();
      return report;
    });
  }
  getAcceptance(setId: string): CalibrationAcceptance | null {
    idSchema.parse(setId);
    return persist(() => {
      const row = this.db
        .prepare(
          "SELECT set_id, set_hash, fingerprints_json, test_run_id, accepted_at FROM calibration_acceptance WHERE set_id = ?",
        )
        .get(setId) as
        | {
            set_id: string;
            set_hash: string;
            fingerprints_json: string;
            test_run_id: string;
            accepted_at: number;
          }
        | undefined;
      if (!row) return null;
      const parsed = calibrationSchema.parse({
        setId: row.set_id,
        setHash: row.set_hash,
        modelFingerprints: JSON.parse(row.fingerprints_json),
        testRunId: row.test_run_id,
        acceptedAt: row.accepted_at,
      });
      if (
        parsed.setId !== setId ||
        new Set(parsed.modelFingerprints).size !==
          parsed.modelFingerprints.length
      )
        throw new PersistenceError();
      const { setId: _id, ...acceptance } = parsed;
      if (
        !matchesEvidence(
          this.getReport(acceptance.testRunId),
          setId,
          acceptance,
        )
      )
        throw new PersistenceError();
      return acceptance;
    });
  }
  accept(setId: string, value: CalibrationAcceptance): CalibrationAcceptance {
    const accepted = calibrationSchema.parse({ setId, ...value });
    return persist(() =>
      this.db.transaction(() => {
        const report = this.getReport(accepted.testRunId);
        const current = this.db
          .prepare("SELECT hash FROM question_sets WHERE id = ?")
          .get(setId) as { hash: string } | undefined;
        if (
          !matchesEvidence(report, setId, accepted) ||
          current?.hash !== accepted.setHash
        )
          throw new PersistenceError();
        this.db
          .prepare(
            "INSERT INTO calibration_acceptance(set_id, set_hash, fingerprints_json, test_run_id, accepted_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(set_id) DO UPDATE SET set_hash=excluded.set_hash, fingerprints_json=excluded.fingerprints_json, test_run_id=excluded.test_run_id, accepted_at=excluded.accepted_at",
          )
          .run(
            setId,
            accepted.setHash,
            JSON.stringify(accepted.modelFingerprints),
            accepted.testRunId,
            accepted.acceptedAt,
          );
        return value;
      })(),
    );
  }
}
