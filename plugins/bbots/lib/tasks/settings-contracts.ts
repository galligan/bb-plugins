import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema } from "../storage/schema.ts";
import { boardSchema, prefixSchema } from "./client.ts";

export const taskSettingsState = z.strictObject({
  botId: idSchema,
  revision: z.number().int().nonnegative(),
  kind: z.enum(["unconfigured", "tasks", "markdown"]),
  availability: z.enum([
    "unconfigured",
    "available",
    "unavailable",
    "recovery-required",
    "changed-during-read",
  ]),
  board: z
    .strictObject({
      id: idSchema,
      name: z.string().max(512).nullable(),
      prefix: prefixSchema.nullable(),
    })
    .nullable(),
  file: z
    .strictObject({ hostId: idSchema, path: z.string().min(1).max(4096) })
    .nullable(),
  catalog: z.strictObject({
    status: z.enum(["available", "unavailable", "not-applicable"]),
    boards: z.array(boardSchema).max(100),
    hasMore: z.boolean(),
  }),
});
export type TaskSettingsState = z.infer<typeof taskSettingsState>;
export const taskSettingsContract = defineRpcContract({
  taskSettings: {
    input: z.strictObject({
      botId: idSchema,
      query: z.string().max(128).default(""),
    }),
    output: taskSettingsState,
    tags: () => ["bots"],
  },
  taskBoardSelect: {
    input: z.strictObject({
      botId: idSchema,
      expectedRevision: z.number().int().nonnegative(),
      boardId: idSchema,
    }),
    output: taskSettingsState,
  },
});
