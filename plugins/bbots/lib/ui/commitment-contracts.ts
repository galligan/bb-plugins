import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { idSchema, nameSchema, changeSchema } from "../storage/schema.ts";
import {
  commitmentIdSchema,
  referenceSchema,
  commitmentSchema,
} from "../commitments/contracts.ts";

const identity = { threadId: idSchema, botId: idSchema, name: nameSchema };
const owner = z.strictObject({
  conversationId: idSchema,
  threadId: idSchema.nullable(),
  role: z.enum(["main", "worker"]),
});
const header = {
  id: commitmentIdSchema,
  revision: z.number().int().positive(),
  owner,
};
export const commitmentUiContract = defineRpcContract({
  botCommitments: {
    input: z.strictObject({
      threadId: idSchema,
      after: commitmentIdSchema.optional(),
    }),
    output: z.strictObject({
      ...identity,
      records: z
        .array(
          z.strictObject({
            ...header,
            excerpt: z.string().max(256),
            referenceKind: z.enum(["unlinked", "tasks", "markdown"]),
            localStatus: z.enum(["open", "closed"]).nullable(),
            evidenceCount: z.number().int().min(0).max(20),
          }),
        )
        .max(10),
      nextCursor: commitmentIdSchema.nullable(),
    }),
    tags: () => ["bots"],
  },
  botCommitment: {
    input: z.strictObject({ threadId: idSchema, id: commitmentIdSchema }),
    output: z.strictObject({
      ...identity,
      ...header,
      what: commitmentSchema.shape.what,
      evidence: commitmentSchema.shape.evidence,
      reference: referenceSchema,
      ...changeSchema.shape,
      availability: z.enum([
        "local",
        "source-reconciliation-required",
        "manual-source-read",
        "changed-during-read",
        "missing",
        "wrong-source",
        "available",
        "unavailable",
      ]),
      authority: z.enum(["commitment", "tasks", "markdown"]),
      status: z
        .enum([
          "open",
          "closed",
          "backlog",
          "todo",
          "in_progress",
          "in_review",
          "done",
          "canceled",
        ])
        .nullable(),
      task: z
        .strictObject({ key: z.string().max(128), title: z.string().max(512) })
        .nullable(),
      limitation: z.string().max(2048).nullable(),
      inspectedAt: z.string().max(64),
    }),
    tags: () => ["bots"],
  },
});
