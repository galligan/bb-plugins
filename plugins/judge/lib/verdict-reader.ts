import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { summarySchema, parseMetadata } from "./verdict-metadata.ts";
import type { ModelService } from "./models.ts";
import {
  currentPublication,
  currentStoredPublication,
} from "./verdict-current.ts";
import type { JudgeRepository } from "./storage.ts";
import type { SetService } from "./sets.ts";
import type { CalibrationService } from "./calibration.ts";
import type { TriggerService } from "./triggers.ts";
import type { SourceSdk } from "./sources/contracts.ts";
import { Deadline } from "./deadline.ts";
import { canonicalJson } from "./json.ts";
export const verdictKeysSchema = z.strictObject({
  threadIds: z
    .array(idSchema)
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const verdictKeysOutput = z.strictObject({
  threads: z
    .array(
      z.strictObject({
        threadId: idSchema,
        summaries: z.array(summarySchema).max(20),
        publicationFailure: idSchema.nullable(),
      }),
    )
    .max(200),
});
export const verdictContracts = {
  "verdicts.keyed": { input: verdictKeysSchema, output: verdictKeysOutput },
};
/** Metadata is untrusted display data, checked against live authoritative records. */
export class VerdictReader {
  private dependencies: {
    repository: JudgeRepository;
    sets: SetService;
    calibration: CalibrationService;
    triggers: TriggerService;
    sdk: SourceSdk;
    models: ModelService;
  };
  private disposal = new AbortController();
  constructor(dependencies: VerdictReader["dependencies"]) {
    this.dependencies = dependencies;
  }
  dispose(): void {
    this.disposal.abort();
  }
  async keyed(value: unknown, signal?: AbortSignal) {
    const input = verdictKeysSchema.parse(value);
    const scope = new Deadline({
      deadlineAt: performance.now() + 5000,
      signals: [signal, this.disposal.signal],
    });
    try {
      scope.assertActive();
      const generation = this.dependencies.models.configurationGeneration();
      const response = z
        .object({
          threads: z
            .array(z.object({ threadId: idSchema, metadata: z.unknown() }))
            .max(200),
        })
        .parse(
          await scope.run(() =>
            this.dependencies.sdk.threads.experimental_listPluginMetadata({
              threadIds: input.threadIds,
              signal: scope.signal,
            }),
          ),
        );
      if (
        new Set(response.threads.map((row) => row.threadId)).size !==
          response.threads.length ||
        response.threads.some((row) => !input.threadIds.includes(row.threadId))
      )
        throw new Error("metadata_invalid");
      const threads = [];
      for (const threadId of input.threadIds) {
        scope.assertActive();
        const raw = response.threads.find((row) => row.threadId === threadId);
        let summaries: z.infer<typeof summarySchema>[] = [];
        let publicationFailure: string | null = null;
        const latest = this.dependencies.repository.triggerAttempts.list({
          threadId,
          limit: 1,
        }).attempts[0];
        if (latest?.publication === "failed" || latest?.publication === "stale")
          publicationFailure = latest.code;
        if (raw) {
          let parsed;
          try {
            parsed = parseMetadata(raw.metadata);
          } catch {
            publicationFailure = "invalid_metadata";
          }
          if (parsed) {
            const refs =
              this.dependencies.repository.publications.forThread(threadId);
            for (const summary of parsed.verdicts.summaries) {
              const ref = refs.find(
                (ref) =>
                  ref.published &&
                  ref.runId === summary.runId &&
                  canonicalJson(ref.summary) === canonicalJson(summary),
              );
              if (
                ref &&
                (await currentPublication(this.dependencies, ref, scope))
              )
                summaries.push(summary);
              else publicationFailure ??= "stale_metadata";
            }
          }
        }
        threads.push({ threadId, summaries, publicationFailure });
      }
      scope.assertActive();
      const changed =
        this.dependencies.models.configurationGeneration() !== generation;
      for (const thread of threads) {
        scope.assertActive();
        const current = this.dependencies.repository.publications.forThread(
          thread.threadId,
        );
        thread.summaries = thread.summaries.filter((summary) => {
          scope.assertActive();
          const ref = current.find(
            (ref) =>
              ref.published &&
              ref.runId === summary.runId &&
              canonicalJson(ref.summary) === canonicalJson(summary),
          );
          const valid =
            !changed &&
            ref !== undefined &&
            currentStoredPublication(this.dependencies, ref);
          if (!valid) thread.publicationFailure ??= "stale_metadata";
          return valid;
        });
      }
      scope.assertActive();
      return { threads };
    } finally {
      scope.close();
    }
  }
}
