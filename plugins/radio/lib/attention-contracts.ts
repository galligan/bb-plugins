import { z } from "zod";
export const requiredCursorSchema = z
  .object({
    cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    targetId: z.string().max(256),
  })
  .strict();
export const attentionSchema = z
  .object({
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    requiredAfter: requiredCursorSchema.default({ cursor: 0, targetId: "" }),
    commitmentAfter: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    since: z.iso.datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export type AttentionRequest = z.infer<typeof attentionSchema>;
export interface DiscoveryItem {
  id: string;
  cursor: number;
  channelId: string;
  authorId: string;
  body: string;
  createdAt: string;
}
export interface RequiredResponse {
  txId: string;
  cursor: number;
  targetId: string;
  needAck: boolean;
  needReply: boolean;
}
