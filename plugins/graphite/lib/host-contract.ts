import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const offshootSchema = z.object({
  name: z.string(),
  column: z.number(),
  parent: z.string().nullable(),
  needsRestack: z.boolean(),
  isStale: z.boolean(),
});

const branchSchema = z.object({
  name: z.string(),
  isCurrent: z.boolean(),
  needsRestack: z.boolean(),
  isStale: z.boolean(),
  offshoots: z.array(offshootSchema),
});

const stackResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("none"), reason: z.string() }),
  z.object({
    outcome: z.literal("stacked"),
    branch: z.string(),
    position: z.number(),
    total: z.number(),
    placement: z.enum(["top", "middle", "bottom"]),
    needsRestack: z.boolean(),
    isStale: z.boolean(),
    warnings: z.array(z.string()),
    branches: z.array(branchSchema),
  }),
]);

const gtResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("ran"), exitCode: z.number(), stdout: z.string(), stderr: z.string() }),
  z.object({ outcome: z.literal("not_found"), tried: z.array(z.string()) }),
  z.object({ outcome: z.literal("failed"), message: z.string() }),
]);

export const graphiteHostContract = defineRpcContract({
  stack: {
    input: z.object({ repoPath: z.string(), branchName: z.string() }),
    output: stackResultSchema,
  },
  gt: {
    input: z.object({ cwd: z.string(), args: z.array(z.string()) }),
    output: gtResultSchema,
  },
});

export type HostStackResult = z.infer<typeof stackResultSchema>;
