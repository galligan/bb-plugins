import type { BbPluginApi, ExperimentalHostClient } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { hostContract } from "./lib/host-contract.ts";
import {
  branchSettingsSchema,
  effectiveBranchSettings,
  projectSettingsSchema,
  type ProjectSettings,
} from "./lib/project-settings.ts";
import { detectionSchema } from "./lib/detection-schema.ts";
const projectInput = z.strictObject({ projectId: z.string().min(1) });
const patchSchema = projectSettingsSchema.omit({ version: true }).partial();
const settingsOutput = z.object({
  stored: projectSettingsSchema.nullable(),
  global: branchSettingsSchema,
  effective: branchSettingsSchema,
  managedBranchPrefix: z.string(),
});
export const projectContract = {
  projects: {
    input: z.strictObject({}),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        hostId: z.string(),
        hostName: z.string(),
      }),
    ),
  },
  projectSettings: { input: projectInput, output: settingsOutput },
  setProjectSettings: {
    input: projectInput.extend({ patch: patchSchema }),
    output: settingsOutput,
  },
  detectSetup: {
    input: projectInput.extend({ hostId: z.string().min(1) }),
    output: detectionSchema,
  },
};
export function projectSettingsStore(bb: BbPluginApi) {
  const warned = new Set<string>();
  return {
    async read(projectId: string): Promise<ProjectSettings | null> {
      try {
        const value = await bb.storage.kv.get<unknown>(`project:${projectId}`);
        if (value === undefined) return null;
        const parsed = projectSettingsSchema.safeParse(value);
        if (parsed.success) return parsed.data;
      } catch {
        /* A broken preference must not prevent a launch. */
      }
      if (!warned.has(projectId)) {
        warned.add(projectId);
        bb.log.warn(
          `Ignoring unreadable Worktree+ project settings for ${projectId}.`,
        );
      }
      return null;
    },
  };
}
export function projectHandlers(
  bb: BbPluginApi,
  host: ExperimentalHostClient<typeof hostContract>,
  store: ReturnType<typeof projectSettingsStore>,
  globalSettings: () => Promise<z.infer<typeof branchSettingsSchema>>,
) {
  async function projectSettings({ projectId }: { projectId: string }) {
    await bb.sdk.projects.get({ projectId });
    const [stored, global, config] = await Promise.all([
      store.read(projectId),
      globalSettings(),
      bb.sdk.system.config(),
    ]);
    return {
      stored,
      global,
      effective: effectiveBranchSettings(global, stored),
      managedBranchPrefix: config.generalSettings.managedBranchPrefix,
    };
  }
  return {
    projectSettings,
    async projects() {
      const [projects, hosts] = await Promise.all([
        bb.sdk.projects.list({ includePersonal: true }),
        bb.sdk.hosts.list(),
      ]);
      return projects.flatMap((project) =>
        project.sources.flatMap((source) => {
          const host = hosts.find(
            (host) => host.id === source.hostId && host.status === "connected",
          );
          return source.type === "local_path" && host !== undefined
            ? [
                {
                  id: project.id,
                  name: project.name,
                  hostId: host.id,
                  hostName: host.name,
                },
              ]
            : [];
        }),
      );
    },
    async setProjectSettings({
      projectId,
      patch,
    }: {
      projectId: string;
      patch: z.infer<typeof patchSchema>;
    }) {
      await bb.sdk.projects.get({ projectId });
      const row = projectSettingsSchema.parse({
        version: 1,
        ...(await store.read(projectId)),
        ...patch,
      });
      if (row.prefixBranches == null && row.branchPrefix == null)
        await bb.storage.kv.delete(`project:${projectId}`);
      else await bb.storage.kv.set(`project:${projectId}`, row);
      return projectSettings({ projectId });
    },
    async detectSetup({
      projectId,
      hostId,
    }: {
      projectId: string;
      hostId: string;
    }) {
      const project = await bb.sdk.projects.get({ projectId });
      const source = project.sources.find(
        (source) => source.type === "local_path" && source.hostId === hostId,
      );
      if (source === undefined)
        throw new Error("This project has no local checkout on that machine.");
      return host.call(
        "setupPlan",
        { sourcePath: source.path },
        { hostId, timeoutMs: 20000 },
      );
    },
  };
}
