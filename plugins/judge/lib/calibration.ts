import type { ModelService } from "./models.ts";
import type { SetService } from "./sets.ts";
import type { JudgeRepository } from "./storage.ts";
import { Deadline } from "./deadline.ts";
import { canonicalJson, ValidationError } from "./json.ts";
import { idSchema } from "./contracts.ts";
import type { EvaluationReport } from "./evaluation-contract.ts";

/** Acceptance is an explicit decision about the primary variant, never a comparison winner. */
export class CalibrationService {
  private repository: JudgeRepository;
  private sets: SetService;
  private models: ModelService;
  private disposal = new AbortController();
  private listeners = new Set<(setId: string) => void>();
  constructor(
    repository: JudgeRepository,
    sets: SetService,
    models: ModelService,
  ) {
    this.repository = repository;
    this.sets = sets;
    this.models = models;
  }
  dispose(): void {
    this.disposal.abort();
    this.listeners.clear();
  }
  onChange(listener: (setId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private async current(
    report: EvaluationReport,
    scope: Deadline,
  ): Promise<boolean> {
    scope.assertActive();
    const saved = this.sets.get(report.set.id);
    if (
      !report.complete ||
      report.stale ||
      !report.variants[0]!.identities.length ||
      saved?.hash !== report.set.hash ||
      this.models.configurationGeneration() !== report.configurationGeneration
    )
      return false;
    const expectedCases = saved.definition.cases.map((authored, index) => ({
      index,
      id: authored.id ?? null,
      expect: authored.expect,
    }));
    if (
      report.stepsPerCase !== saved.definition.steps.length ||
      canonicalJson(report.cases) !== canonicalJson(expectedCases)
    )
      return false;
    for (const identity of report.variants[0]!.identities)
      if (!(await scope.run(() => this.models.isCurrent(identity))))
        return false;
    scope.assertActive();
    return (
      this.sets.get(report.set.id)?.hash === report.set.hash &&
      this.models.configurationGeneration() === report.configurationGeneration
    );
  }
  async accept(id: string, run: string, signal?: AbortSignal) {
    idSchema.parse(id);
    idSchema.parse(run);
    const scope = new Deadline({
      deadlineAt: performance.now() + 5000,
      signals: [signal, this.disposal.signal],
    });
    try {
      const report = this.repository.evaluations.getReport(run);
      if (
        !report ||
        report.set.id !== id ||
        !(await this.current(report, scope))
      )
        throw new ValidationError("calibration_not_current");
      const modelFingerprints = [
        ...new Set(
          report.variants[0]!.identities.map(
            (identity) => identity.fingerprint,
          ),
        ),
      ];
      // No await between the final active/current check and the synchronous transaction.
      scope.assertActive();
      if (
        this.models.configurationGeneration() !==
          report.configurationGeneration ||
        this.sets.get(id)?.hash !== report.set.hash
      )
        throw new ValidationError("calibration_not_current");
      const accepted = this.repository.evaluations.accept(id, {
        setHash: report.set.hash,
        modelFingerprints,
        testRunId: report.id,
        acceptedAt: Date.now(),
      });
      for (const listener of this.listeners)
        try {
          listener(id);
        } catch {
          /* The committed acceptance remains successful; readers also recheck authoritative evidence. */
        }
      return { setId: id, ...accepted };
    } finally {
      scope.close();
    }
  }
  async get(id: string, signal?: AbortSignal) {
    idSchema.parse(id);
    const scope = new Deadline({
      deadlineAt: performance.now() + 5000,
      signals: [signal, this.disposal.signal],
    });
    try {
      scope.assertActive();
      const accepted = this.repository.evaluations.getAcceptance(id);
      if (!accepted) return null;
      const report = this.repository.evaluations.getReport(accepted.testRunId);
      if (
        !report ||
        report.set.hash !== accepted.setHash ||
        !(await this.current(report, scope))
      )
        return null;
      const current = this.repository.evaluations.getAcceptance(id);
      if (
        current?.testRunId !== accepted.testRunId ||
        current.acceptedAt !== accepted.acceptedAt
      )
        return null;
      if (
        this.models.configurationGeneration() !==
          report.configurationGeneration ||
        this.sets.get(id)?.hash !== report.set.hash
      )
        return null;
      return { setId: id, ...accepted };
    } finally {
      scope.close();
    }
  }
}
