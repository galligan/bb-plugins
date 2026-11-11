import { z } from "zod";

export const idSchema = z.string().min(1).max(128);
export const revisionSchema = z.number().int().positive();
export const changeSchema = z.strictObject({
  author: z.string().trim().min(1).max(256),
  reason: z.string().trim().min(1).max(2048),
});
export const nameSchema = z.string().trim().min(1).max(128);
export const botSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  revision: revisionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const conversationSchema = z.strictObject({
  id: idSchema,
  botId: idSchema,
  role: z.enum(["main", "worker"]),
  threadId: idSchema.nullable(),
  createdAt: z.string(),
});
export const documentSchema = z.strictObject({
  id: idSchema,
  botId: idSchema,
  name: nameSchema,
  revision: revisionSchema,
  markdown: z.string().max(65_536),
  author: changeSchema.shape.author,
  reason: changeSchema.shape.reason,
  createdAt: z.string(),
});
export type Change = z.infer<typeof changeSchema>;
export type Bot = z.infer<typeof botSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Document = z.infer<typeof documentSchema>;
