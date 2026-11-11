import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { operationSchema, type RadioOperation } from "./operation-contracts.ts";
import { resultSchema } from "./surface-contract.ts";

const kinds = [
  "read",
  "scan",
  "responses",
  "response-summary",
  "commitment",
  "commitment-events",
  "dispatch-read",
  "dispatch-list",
  "channels",
  "handles",
  "handle-read",
] as const;
type BrowseKind = (typeof kinds)[number];
export function isBrowseOperation(op: RadioOperation["op"]): op is BrowseKind {
  return (kinds as readonly string[]).includes(op);
}
type BrowseOption = Extract<
  (typeof operationSchema.options)[number],
  { shape: { op: z.ZodLiteral<BrowseKind> } }
>;
const [first, ...rest] = operationSchema.options.filter(
  (option): option is BrowseOption => isBrowseOperation(option.shape.op.value),
);
export const browseOperationSchema = z.discriminatedUnion("op", [
  first!,
  ...rest,
]);
export const browseInputSchema = z
  .object({ projectId: idSchema, request: browseOperationSchema })
  .strict();
export const browseResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      project: z
        .object({ id: idSchema, name: z.string(), channelId: idSchema })
        .strict(),
      data: z.json(),
    })
    .strict(),
  resultSchema.options[1],
]);
export const browseContract = {
  browse: {
    input: browseInputSchema,
    output: browseResultSchema,
    tags: () => ["radio"],
  },
} satisfies PluginRpcContract;
