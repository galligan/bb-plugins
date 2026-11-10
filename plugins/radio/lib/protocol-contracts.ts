import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { RadioError } from "./errors.ts";

const base = {
  txId: idSchema,
  targetId: idSchema,
  idempotencyKey: z.string().min(1).max(128),
};
export const responseSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("received") }).strict(),
  z.object({ ...base, kind: z.literal("ack") }).strict(),
  z
    .object({
      ...base,
      kind: z.literal("standby"),
      reason: z.string().trim().min(1).max(400).optional(),
    })
    .strict(),
  z.object({ ...base, kind: z.literal("squelch") }).strict(),
]);
export type ResponseKind = z.infer<typeof responseSchema>["kind"];
export interface ProtocolEvent {
  stationId: string;
  id: string;
  cursor: number;
  txId: string;
  targetId: string;
  actorId: string;
  sessionId: string | null;
  kind: ResponseKind;
  payload: {
    endpointId?: string;
    evidence?: "recipient-confirmation";
    reason?: string;
  };
  createdAt: string;
}
export const eventPageSchema = z
  .object({
    txId: idSchema,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export function parseProtocol<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new RadioError(
      "invalid_input",
      `Invalid protocol operation: ${parsed.error.issues[0]!.message}`,
    );
  return parsed.data;
}
