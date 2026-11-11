import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { RadioStore } from "./storage.ts";
import { RadioReads } from "./project-reads.ts";
import {
  browseContract,
  browseInputSchema,
  type browseResultSchema,
} from "./browse-contract.ts";
import { surfaceFailure } from "./surface-result.ts";
import { RadioError } from "./errors.ts";

export function registerBrowse(bb: BbPluginApi, store: RadioStore) {
  const reads = new RadioReads(bb.storage.database(), store);
  bb.rpc.register(browseContract, {
    async browse(
      input,
      invocation,
    ): Promise<z.infer<typeof browseResultSchema>> {
      try {
        const { projectId, request } = browseInputSchema.parse(input);
        const signal = invocation.experimental_signal;
        signal?.throwIfAborted();
        // Account-local access authorizes project browsing, never acting as @user or a thread.
        const project = await bb.sdk.projects.get({ projectId, signal });
        signal?.throwIfAborted();
        if (project.id !== projectId)
          throw new RadioError("not_found", "Unknown browsing project.");
        const radioProject = store.projects.localProject(
          project.id,
          project.name,
        );
        const data = reads.execute(
          { projectIds: [projectId], currentProjectId: projectId },
          request,
        );
        return { ok: true, project: radioProject, data: z.json().parse(data) };
      } catch (error) {
        const result = surfaceFailure(error);
        if (!result.ok) return result;
        throw error;
      }
    },
  });
}
