import {
  defineRpcContract,
  type ExperimentalHostSignals,
} from "@get-bb/plugin-sdk";
import { z } from "zod";
import { detectionSchema } from "./detection-schema.ts";
import { rescueSchema } from "./rescue-schema.ts";

const failed = z.strictObject({
  status: z.literal("failed"),
  message: z.string().min(1),
});

export const inspectionSchema = z.strictObject({
  path: z.string().min(1),
  branch: z.string().min(1).nullable(),
  changedFiles: z.number().int().nonnegative(),
  untrackedFiles: z.number().int().nonnegative(),
  editedSharedFiles: z.array(z.string()),
  conflictedFiles: z.number().int().nonnegative(),
  operation: z.string().nullable(),
  unreferencedHead: z.boolean(),
  unsavedSubmodules: z.array(z.string()),
  branchState: z.enum(["no-commits", "merged", "pushed", "local", "detached"]),
  unpushedCommits: z.number().int().nonnegative(),
  lastActivity: z.number().nullable(),
  safeToRemove: z.boolean(),
  reasons: z.array(z.string()),
});

export const listedWorktreeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("present"),
    pathKey: z.string().min(1),
    sourcePath: z.string().optional(),
    inspection: inspectionSchema,
  }),
  z.strictObject({
    status: z.literal("missing"),
    pathKey: z.string().min(1),
    sourcePath: z.string().optional(),
    path: z.string().min(1),
  }),
  z.strictObject({
    status: z.literal("unreadable"),
    pathKey: z.string().min(1),
    sourcePath: z.string().optional(),
    path: z.string().min(1),
    message: z.string(),
  }),
]);
export type ListedWorktree = z.infer<typeof listedWorktreeSchema>;

/** Calls the server makes to the machine that owns the checkout. */
export const hostContract = defineRpcContract({
  resolve: {
    input: z.strictObject({
      pathKey: z.string().min(1),
      sourcePath: z.string().min(1),
      branchName: z.string().min(1),
      base: z.string().min(1).nullable(),
    }),
    output: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("resolved"),
        path: z.string().min(1),
        mergeBaseBranch: z.string().min(1).nullable(),
      }),
      failed,
    ]),
  },
  create: {
    input: z.strictObject({
      operationId: z.string().min(1),
      pathKey: z.string().min(1),
    }),
    output: z.discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("created"),
        path: z.string().min(1),
        mergeBaseBranch: z.string().min(1).nullable(),
      }),
      failed,
    ]),
  },
  remove: {
    input: z.strictObject({
      operationId: z.string().min(1),
      pathKey: z.string().min(1),
      path: z.string().min(1).nullable(),
    }),
    output: z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("removed") }),
      failed,
    ]),
  },
  defaultBase: {
    input: z.strictObject({ sourcePath: z.string().min(1) }),
    output: z.strictObject({ base: z.string().min(1).nullable() }),
    experimental_retryable: true,
  },
  setupPlan: {
    input: z.strictObject({ sourcePath: z.string().min(1) }),
    output: detectionSchema,
    experimental_retryable: true,
  },
  rescues: {
    input: z.strictObject({ sourcePaths: z.array(z.string().min(1)) }),
    output: z.object({
      sources: z.array(
        z.object({
          sourcePath: z.string(),
          refs: z.array(rescueSchema),
          error: z.string().nullable(),
        }),
      ),
    }),
    experimental_retryable: true,
  },
  list: {
    input: z.strictObject({ includeSource: z.boolean().optional() }),
    output: z.strictObject({ worktrees: z.array(listedWorktreeSchema) }),
    experimental_retryable: true,
  },
});

/** Progress for one running `create` or `remove`, keyed by its operation id. */
export const hostSignals = {
  progress: {
    payload: z.strictObject({
      operationId: z.string().min(1),
      kind: z.enum(["step", "log"]),
      text: z.string(),
    }),
  },
} satisfies ExperimentalHostSignals;
