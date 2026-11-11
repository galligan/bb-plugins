import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  fixtureHostOptions,
  setupRunner,
  question,
} from "./runner-fixtures.ts";
type Sdk = BbPluginApi["sdk"];
type Thread = Awaited<ReturnType<Sdk["threads"]["get"]>>;
export const triggerDefinition = {
  schemaVersion: 1,
  id: "event-set",
  description: "Synthetic events only",
  model: "private",
  projects: "all",
  budgetMs: 5000,
  inputs: { reply: { from: "thread.lastAssistantText" } },
  questions: question,
  outcomes: { accepted: { q: "q", gte: 0.7 } },
  cases: [
    {
      inputs: { reply: "AUTHORED_SYNTHETIC_TEXT" },
      expect: { accepted: true },
    },
  ],
};
/** Call createFakePluginHost in .test files; this helper imports only public production types. */
export function triggerHostOptions(base: Thread) {
  const threads = new Map<string, Thread>();
  const metadata = new Map<string, unknown>();
  let writes = 0;
  let outputs = 0;
  let failWrites = false;
  const current = (id: string) => threads.get(id) ?? { ...base, id };
  const options = {
    ...fixtureHostOptions,
    sdk: {
      threads: {
        get: async (args: Parameters<Sdk["threads"]["get"]>[0]) =>
          current(args.threadId),
        output: async () => {
          outputs++;
          return { output: "STALE_SYNTHETIC_OUTPUT" };
        },
        events: {
          list: async (
            args: Parameters<Sdk["threads"]["events"]["list"]>[0],
          ) => [
            {
              threadId: args.threadId,
              seq: 10,
              type: args.types?.includes("client/turn/requested")
                ? "client/turn/requested"
                : "turn/completed",
              data: { requestId: `request-${args.threadId}` },
            },
          ],
        },
        getPluginMetadata: async (
          args: Parameters<Sdk["threads"]["getPluginMetadata"]>[0],
        ) => structuredClone(metadata.get(args.threadId) ?? {}),
        experimental_listPluginMetadata: async (
          args: Parameters<
            Sdk["threads"]["experimental_listPluginMetadata"]
          >[0],
        ) => ({
          threads: args.threadIds
            .filter((id) => metadata.has(id))
            .map((threadId) => ({
              threadId,
              metadata: structuredClone(metadata.get(threadId)),
            })),
        }),
        updatePluginMetadata: async (
          args: Parameters<Sdk["threads"]["updatePluginMetadata"]>[0],
        ) => {
          writes++;
          if (failWrites) throw new Error("PRIVATE_METADATA_ERROR");
          const value = structuredClone(
            metadata.get(args.threadId) ?? {},
          ) as Record<string, unknown>;
          for (const key of args.remove ?? []) delete value[key];
          Object.assign(value, args.set);
          metadata.set(args.threadId, value);
          return structuredClone(value);
        },
      },
    },
  };
  return {
    options,
    threads,
    metadata,
    current,
    writes: () => writes,
    outputs: () => outputs,
    setWriteFailure: (value: boolean) => {
      failWrites = value;
    },
  };
}
export async function setupTriggers<T extends { bb: BbPluginApi }>(
  host: T,
  controls: ReturnType<typeof triggerHostOptions>,
  fetcher?: typeof fetch,
) {
  const h = await setupRunner(host, fetcher);
  h.api.sets.save(JSON.stringify(triggerDefinition));
  const report = await h.api.evaluations.test({ id: "event-set" });
  if (!report.complete) throw new Error("synthetic evaluation fixture");
  await h.api.calibration.accept("event-set", report.id);
  const triggers = h.api.triggers,
    publisher = h.api.publisher,
    engine = h.api.triggerEngine;
  h.bodies.length = 0;
  const enable = (event = "thread.idle", projects: unknown = "all") => {
    triggers.save({
      id: "binding",
      setId: "event-set",
      event,
      projects,
      badges: { accepted: "Synthetic verdict" },
    });
    return triggers.enable("binding", true);
  };
  const idle = (
    id = "thread",
    text: string | null = "SYNTHETIC_CURRENT_REPLY",
  ) => ({ thread: controls.current(id), lastAssistantText: text });
  return { ...h, ...controls, triggers, publisher, engine, enable, idle };
}
