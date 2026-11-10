import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { JudgeApi, registerRpc } from "./api.ts";
import { registerCli } from "./cli.ts";
import { createModelService } from "./models.ts";
import { openJudgeStorage } from "./storage.ts";
import type { InferenceRequest, Questions } from "./contracts.ts";
import type { Expression } from "./outcomes.ts";
import type { SourceDefinition } from "./sets-schema.ts";

export const thread = {
  id: "thread",
  projectId: "project",
  environmentId: "exact-env",
  providerId: "codex",
  title: "Synthetic title",
};
export const question: Questions = {
  q: { type: "noul", instructions: "Is the synthetic evidence sufficient?" },
};
export const predicates = { ok: { q: "q", gte: 0.7 } };
type FixtureStep = {
  id: string;
  inputs: Record<string, Partial<SourceDefinition>>;
  questions: Questions;
  outcomes: Record<string, Expression>;
  when?: Expression;
  model?: string;
};
export function definition() {
  const steps: FixtureStep[] = [
    {
      id: "screen",
      inputs: { provider: { from: "provider.id" } },
      questions: question,
      outcomes: predicates,
    },
    {
      id: "detail",
      when: "screen.ok",
      inputs: { reply: { from: "thread.lastAssistantText" } },
      questions: question,
      outcomes: predicates,
    },
  ];
  return {
    schemaVersion: 1,
    id: "synthetic",
    description: "Synthetic runner fixture",
    projects: "all",
    budgetMs: 5000,
    steps,
    outcomes: { accepted: { all: ["screen.ok", "detail.ok"] } } as Record<
      string,
      Expression
    >,
  };
}
export const fixtureHostOptions = {
  pluginId: "judge",
  settings: { typesafeApiKey: "dummy-runner-secret" },
  sdk: {
    threads: {
      get: async () => thread,
      output: async () => ({ output: "Synthetic reply" }),
    },
    plugins: {
      callRpc: async () => ({
        outcome: "available",
        diff: {
          diff: "+synthetic",
          truncated: false,
          shortstat: "",
          files: "synthetic.ts",
          mergeBaseRef: null,
        },
      }),
    },
  },
};
export async function setupRunner<T extends { bb: BbPluginApi }>(
  host: T,
  fetcher?: typeof fetch,
) {
  const bodies: InferenceRequest[] = [];
  const repository = openJudgeStorage(host.bb.storage);
  const models = await createModelService(host.bb, repository);
  const api = new JudgeApi(
    models,
    repository,
    host.bb.sdk,
    async (url, options) => {
      const body = JSON.parse(String(options?.body)) as InferenceRequest;
      bodies.push(body);
      return fetcher
        ? fetcher(url, options)
        : Response.json({
            model: "fixture-version",
            answers: Object.fromEntries(
              Object.keys(body.questions).map((q) => [
                q,
                { type: "noul", noul: 0.9 },
              ]),
            ),
          });
    },
  );
  host.bb.onDispose(() => api.dispose());
  registerRpc(host.bb, api);
  registerCli(host.bb, api);
  models.save({
    id: "public",
    connection: "typesafe",
    model: "public-selector",
  });
  models.save({
    id: "private",
    connection: "typesafe",
    model: "private-selector",
    allowPrivate: true,
  });
  models.setDefault("public");
  models.setDefault("private", true);
  api.sets.save(JSON.stringify(definition()));
  return { ...host, repository, api, bodies };
}
