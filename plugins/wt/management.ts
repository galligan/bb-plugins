import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { hostContract } from "./lib/host-contract.ts";
import type { ExperimentalHostClient } from "@get-bb/plugin-sdk";
import {
  environmentSchema,
  joinOverview,
  machineSchema,
  threadSchema,
} from "./lib/overview.ts";
import { rescueSchema } from "./lib/rescue-schema.ts";
import { requestRemoval } from "./lib/removal-request.ts";

export const managementContract = {
  overview: {
    input: z.strictObject({}),
    output: z.object({
      machines: z.array(machineSchema),
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  },
  removeWorktree: {
    input: z.strictObject({
      hostId: z.string().min(1),
      pathKey: z.string().min(1),
    }),
    output: z.union([
      z.object({ status: z.enum(["requested", "removed"]) }),
      z.object({ status: z.literal("failed"), message: z.string() }),
    ]),
  },
  rescues: {
    input: z.strictObject({}),
    output: z.object({
      projects: z.array(
        z.object({
          projectId: z.string(),
          hostId: z.string(),
          refs: z.array(rescueSchema),
          error: z.string().nullable(),
        }),
      ),
    }),
  },
};

/** SDK collections use offset pagination, including hidden and archived owners. */
async function allPages<T>(
  fetch: (offset: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await fetch(rows.length);
    rows.push(...page);
    if (page.length < 200) return rows;
  }
}

export function managementHandlers(
  bb: BbPluginApi,
  host: ExperimentalHostClient<typeof hostContract>,
) {
  const connectedHosts = async () =>
    (await bb.sdk.hosts.list()).filter((host) => host.status === "connected");
  const environments = () =>
    allPages((offset) =>
      bb.sdk.environments.list({
        environmentProviderId: "wt",
        limit: 200,
        offset,
      }),
    );
  return {
    async overview() {
      const [hosts, rawEnvs, projects] = await Promise.all([
        connectedHosts(),
        environments(),
        bb.sdk.projects.list(),
      ]);
      const envs = z.array(environmentSchema).parse(rawEnvs);
      const [machines, threadLists] = await Promise.all([
        Promise.all(
          hosts.map(async (machine) => {
            try {
              return {
                hostId: machine.id,
                name: machine.name,
                error: null,
                ...(await host.call(
                  "list",
                  { includeSource: true },
                  { hostId: machine.id, timeoutMs: 20000 },
                )),
              };
            } catch (error) {
              return {
                hostId: machine.id,
                name: machine.name,
                worktrees: [],
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }),
        ),
        Promise.all(
          envs.flatMap((env) =>
            [false, true].map((archived) =>
              allPages((offset) =>
                bb.sdk.threads.list({
                  environmentId: env.id,
                  archived,
                  includeHidden: true,
                  limit: 200,
                  offset,
                }),
              ),
            ),
          ),
        ),
      ]);
      const threads = threadLists.flat().map((thread) =>
        threadSchema.parse({
          ...thread,
          archived: thread.archivedAt !== null,
        }),
      );
      const joined = joinOverview(machines, envs, threads);
      // Source paths are metadata only; no ignored-file contents or hashes leave the host.
      for (const machine of joined)
        for (const row of machine.worktrees) {
          if (row.environment !== null || row.sourcePath === undefined)
            continue;
          const project = projects.find((project) =>
            project.sources.some(
              (source) =>
                source.type === "local_path" &&
                source.hostId === machine.hostId &&
                source.path === row.sourcePath,
            ),
          );
          if (project !== undefined) row.projectId = project.id;
        }
      return {
        machines: joined,
        projects: projects.map(({ id, name }) => ({ id, name })),
      };
    },
    async removeWorktree({
      hostId,
      pathKey,
    }: {
      hostId: string;
      pathKey: string;
    }) {
      const envs = await environments();
      const env =
        envs.find(
          (env) =>
            env.hostId === hostId &&
            env.environmentProviderInstanceKey === pathKey &&
            env.status !== "destroyed",
        ) ??
        envs.find(
          (env) =>
            env.hostId === hostId &&
            env.environmentProviderInstanceKey === pathKey,
        );
      const result = await requestRemoval(
        env === undefined
          ? null
          : { id: env.id, failed: env.lifecycle.teardown?.status === "failed" },
        {
          deleteEnvironment: (environmentId) =>
            bb.sdk.environments.delete({ environmentId }),
          cleanupEnvironment: (environmentId) =>
            bb.sdk.environments.experimental_cleanup({ environmentId }),
          removeOrphan: () =>
            host.call(
              "remove",
              {
                operationId: `panel-remove#${pathKey}#${String(Date.now())}`,
                pathKey,
                path: null,
              },
              { hostId, timeoutMs: 20 * 60 * 1000 },
            ),
        },
      );
      bb.realtime.publish("worktrees-changed", null);
      return result;
    },
    async rescues() {
      const [hosts, projects] = await Promise.all([
        connectedHosts(),
        bb.sdk.projects.list(),
      ]);
      return {
        projects: (
          await Promise.all(
            hosts.map(async (machine) => {
              const sources = projects.flatMap((project) =>
                project.sources
                  .filter(
                    (source) =>
                      source.type === "local_path" &&
                      source.hostId === machine.id,
                  )
                  .map((source) => ({
                    projectId: project.id,
                    path: source.path,
                  })),
              );
              try {
                const result = await host.call(
                  "rescues",
                  {
                    sourcePaths: [
                      ...new Set(sources.map((source) => source.path)),
                    ],
                  },
                  { hostId: machine.id, timeoutMs: 20000 },
                );
                return sources.map((source) => ({
                  projectId: source.projectId,
                  hostId: machine.id,
                  refs:
                    result.sources.find(
                      (item) => item.sourcePath === source.path,
                    )?.refs ?? [],
                  error:
                    result.sources.find(
                      (item) => item.sourcePath === source.path,
                    )?.error ?? null,
                }));
              } catch (error) {
                return sources.map((source) => ({
                  projectId: source.projectId,
                  hostId: machine.id,
                  refs: [],
                  error: error instanceof Error ? error.message : String(error),
                }));
              }
            }),
          )
        ).flat(),
      };
    },
  };
}
