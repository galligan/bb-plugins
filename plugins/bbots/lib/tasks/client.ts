import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Consumer schemas for Tasks 0.1.2's public RPC. Keep independent of its source.
export const prefixSchema = z.string().regex(/^[A-Z][A-Z0-9]{0,9}$/);
export const boardSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(512),
  prefix: prefixSchema,
});
export type Board = z.infer<typeof boardSchema>;

export function tasksClient(bb: BbPluginApi, lifecycle: AbortSignal) {
  function signal(request?: AbortSignal) {
    return AbortSignal.any([
      lifecycle,
      ...(request ? [request] : []),
      AbortSignal.timeout(5000),
    ]);
  }
  return {
    async task(taskId: string, request?: AbortSignal) {
      const { task } = await bb.sdk.plugins.callRpc({
        pluginId: "tasks",
        method: "getTask",
        input: { taskId },
        outputSchema: z.object({
          task: z
            .object({
              id: z.string().min(1).max(128),
              projectId: z.string().min(1).max(128),
              key: z.string().max(128),
              title: z.string().transform((value) => value.slice(0, 512)),
              status: z.enum([
                "backlog",
                "todo",
                "in_progress",
                "in_review",
                "done",
                "canceled",
              ]),
            })
            .nullable(),
        }),
        signal: signal(request),
      });
      return task;
    },
    async list(request?: AbortSignal) {
      const { projects } = await bb.sdk.plugins.callRpc({
        pluginId: "tasks",
        method: "listProjects",
        input: {},
        outputSchema: z.object({ projects: z.array(boardSchema).max(10000) }),
        signal: signal(request),
      });
      return projects;
    },
    async create(name: string, prefix: string, request?: AbortSignal) {
      const { project } = await bb.sdk.plugins.callRpc({
        pluginId: "tasks",
        method: "createProject",
        input: {
          name,
          prefix,
          color: "blue",
          folderId: null,
          linkedBbProjectId: null,
        },
        outputSchema: z.object({ project: boardSchema }),
        signal: signal(request),
      });
      return project;
    },
  };
}
