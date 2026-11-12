import { z } from "zod";
import { changeSchema, idSchema, revisionSchema } from "../storage/schema.ts";
import { checkpointId } from "../checkpoints/contracts.ts";
import { memoryId } from "../memory/contracts.ts";

export const preparationId = z
  .string()
  .refine(
    (value) =>
      value.startsWith("cnt_") && z.uuid().safeParse(value.slice(4)).success,
    "Use a stable cnt_ preparation ID",
  );
export const prepareSchema = changeSchema.extend({
  botId: idSchema,
  conversationId: idSchema,
  requestId: z.uuid(),
});
const memoryRef = z.strictObject({ id: memoryId, revision: revisionSchema });
const sequence = z.number().int().nonnegative();
const eventRef = z.strictObject({ seq: sequence, createdAt: sequence });
export const observationSchema = z.strictObject({
  observedAt: z.string().max(64),
  threadId: idSchema,
  environmentId: idSchema.nullable(),
  projectId: idSchema,
  providerId: idSchema,
  parentThreadId: idSchema.nullable(),
  parentNotifications: z.enum(["auto", "off", "stuck"]),
  pinnedAt: sequence.nullable(),
  activeBackgroundAgentCount: sequence,
  status: z.string().max(32),
  runtimeStatus: z.string().max(32),
  threadUpdatedAt: sequence,
  usage: z.discriminatedUnion("status", [
    z.strictObject({ status: z.literal("unavailable") }),
    z.strictObject({
      status: z.enum(["fresh", "stale", "estimated"]),
      capturedAt: z.string().max(64),
      usedTokens: z.number().nonnegative(),
      contextWindowTokens: z.number().positive(),
      providerSessionId: z.string().min(1).max(256),
      providerTurnId: z.string().max(256).nullable(),
      model: z.string().max(256),
    }),
  ]),
  queue: z.strictObject({
    count: sequence,
    ids: z.array(idSchema).max(20),
    complete: z.boolean(),
  }),
  events: z.strictObject({
    latestSeq: sequence.nullable(),
    windowFull: z.boolean(),
    manualStop: eventRef.nullable(),
    stopEvidence: z.enum(["manual-stop-observed", "not-established"]),
    latestContextChange: eventRef
      .extend({ type: z.enum(["thread/compacted", "thread/context/cleared"]) })
      .nullable(),
  }),
  automaticTransitions: z.literal("disabled"),
  safeToExecuteTransition: z.literal(false),
  limitations: z.array(z.string().max(512)).max(3),
});
export const preparationSchema = z.strictObject({
  requestId: z.uuid(),
  creationHash: z.string().regex(/^[a-f0-9]{64}$/),
  botId: idSchema,
  conversationId: idSchema,
  sourceThreadId: idSchema,
  role: z.enum(["main", "worker"]),
  checkpointId,
  createdAt: z.string(),
  ...changeSchema.shape,
  soulRevision: revisionSchema.nullable(),
  appliedSoulRevision: z.null(),
  contractRevision: revisionSchema.nullable(),
  taskSourceRevision: z.number().int().nonnegative(),
  commitments: z
    .array(
      z.strictObject({
        id: idSchema,
        revision: revisionSchema,
        ownerConversationId: idSchema,
      }),
    )
    .max(10),
  commitmentsTruncated: z.boolean(),
  knowledge: z.array(memoryRef).max(3),
  captures: z
    .array(memoryRef.extend({ kind: z.enum(["state", "decision", "summary"]) }))
    .max(3),
  phase: z.literal("prepared-references-only"),
  historicalObservation: observationSchema,
});
export type PrepareInput = z.infer<typeof prepareSchema>;
