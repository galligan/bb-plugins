import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { sendSchema, scanSchema } from "./transmission-contracts.ts";
import { attentionSchema } from "./attention-contracts.ts";
import { responseSchema, eventPageSchema } from "./protocol-contracts.ts";
import {
  commitmentActionSchema,
  commitmentListSchema,
} from "./commitment-contracts.ts";
import {
  createDispatchSchema,
  reviseDispatchSchema,
  readDispatchSchema,
  listDispatchSchema,
} from "./dispatch-contracts.ts";
import {
  subscriptionMutationSchema,
  subscriptionListingSchema,
} from "./subscription-contracts.ts";

const empty = z.object({}).strict();
const name = z.string().min(1).max(256);
const handleMutation = z
  .object({ name, targetId: idSchema.optional() })
  .strict();
const page = z
  .object({
    after: z.string().max(256).default(""),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
function operation<const K extends string, S extends z.ZodType>(
  op: K,
  input: S,
) {
  return z.object({ op: z.literal(op), input }).strict();
}
// The operation input never includes caller/author/operator credential fields.
export const operationSchema = z.discriminatedUnion("op", [
  operation("whoami", empty),
  operation("tx", sendSchema),
  operation(
    "reply",
    sendSchema.refine((input) => !!input.replyToId, {
      message: "A reply requires replyToId.",
    }),
  ),
  operation("read", z.object({ id: idSchema }).strict()),
  operation("scan", scanSchema),
  operation("check", attentionSchema),
  operation("respond", responseSchema),
  operation("responses", eventPageSchema),
  operation("response-summary", z.object({ txId: idSchema }).strict()),
  operation("commit", commitmentActionSchema),
  operation("commitments", commitmentListSchema),
  operation("commitment", z.object({ id: idSchema }).strict()),
  operation("commitment-events", eventPageSchema),
  operation("subscribe", subscriptionMutationSchema),
  operation("listening", subscriptionListingSchema),
  operation("dispatch-create", createDispatchSchema),
  operation("dispatch-revise", reviseDispatchSchema),
  operation("dispatch-read", readDispatchSchema),
  operation("dispatch-list", listDispatchSchema),
  operation("channels", page),
  operation("channel-create", z.object({ name }).strict()),
  operation("channel-rename", z.object({ id: idSchema, name }).strict()),
  operation("project-rename", z.object({ name }).strict()),
  operation("handles", page),
  operation("handle-assign", handleMutation),
  operation("handle-rename", handleMutation),
  operation("handle-reclaim", z.object({ name, targetId: idSchema }).strict()),
  operation("alias-remove", z.object({ name }).strict()),
]);
export type RadioOperation = z.infer<typeof operationSchema>;

export function operationIsRead(op: RadioOperation["op"]): boolean {
  return [
    "whoami",
    "read",
    "scan",
    "check",
    "responses",
    "response-summary",
    "commitments",
    "commitment",
    "commitment-events",
    "listening",
    "dispatch-read",
    "dispatch-list",
    "channels",
    "handles",
  ].includes(op);
}
