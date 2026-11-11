import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  botSchema,
  conversationSchema,
  idSchema,
  nameSchema,
} from "../storage/schema.ts";

export const associationsSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("none") }),
  z.strictObject({ mode: z.literal("all") }),
  z.strictObject({
    mode: z.literal("selected"),
    projectIds: z
      .array(idSchema)
      .min(1)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Project IDs must be unique",
      ),
  }),
]);
export const createSchema = z.strictObject({
  requestId: z.uuid(),
  name: nameSchema.default("Bob"),
  hostId: idSchema,
  homeBase: z.string().min(1).max(4096).optional(),
  associations: associationsSchema.default({ mode: "none" }),
  providerId: idSchema.optional(),
  model: z.string().min(1).max(256).optional(),
  reasoningLevel: z.string().trim().min(1).max(128).optional(),
  permissionMode: z.enum(["accept-edits", "auto", "full"]).optional(),
  serviceTier: z.string().min(1).max(128).optional(),
});
export type CreateBotInput = z.infer<typeof createSchema>;
export const setupSchema = z.strictObject({
  botId: idSchema,
  conversationId: idSchema,
  requestId: z.uuid(),
  request: createSchema,
  homePath: z.string().nullable(),
  projectId: idSchema.nullable(),
  phase: z.enum([
    "planned",
    "home-ready",
    "project-creating",
    "project-ready",
    "spawning",
    "owned",
    "ready",
  ]),
  error: z.string().max(1024).nullable(),
});
export type Setup = z.infer<typeof setupSchema>;
export const viewSchema = z.strictObject({
  bot: botSchema,
  main: conversationSchema,
  setup: setupSchema,
});
export const managementContract = defineRpcContract({
  create: { input: createSchema, output: viewSchema },
  resume: { input: z.strictObject({ botId: idSchema }), output: viewSchema },
  show: {
    input: z.strictObject({ botId: idSchema }),
    output: viewSchema,
    tags: () => ["bots"],
  },
  list: {
    tags: () => ["bots"],
    input: z.strictObject({}),
    output: z.strictObject({
      bots: z.array(botSchema).max(100),
      hasMore: z.boolean(),
    }),
  },
  rename: {
    input: z.strictObject({
      botId: idSchema,
      expectedRevision: z.number().int().positive(),
      name: nameSchema,
    }),
    output: viewSchema,
  },
});
export const homeContract = defineRpcContract({
  validateBase: {
    input: z.strictObject({ base: z.string().max(4096).optional() }),
    output: z.strictObject({ path: z.string() }),
  },
  prepare: {
    input: z.strictObject({
      botId: z.string().regex(/^bot_[a-f0-9-]{36}$/),
      base: z.string().max(4096).optional(),
    }),
    output: z.strictObject({
      path: z.string(),
      status: z.enum(["present", "created"]),
    }),
  },
  inspect: {
    input: z.strictObject({
      botId: idSchema,
      path: z.string().min(1).max(4096),
    }),
    output: z.strictObject({
      status: z.enum(["present", "missing", "conflict"]),
    }),
  },
});
