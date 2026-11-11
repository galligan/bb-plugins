import { createContext, useContext } from "react";
import { z } from "zod";
import type { operationSchema } from "../../lib/operation-contracts.ts";
import type { SurfaceResult } from "../../lib/surface-contract.ts";

export const identitySchema = z.object({
  stationId: z.string(),
  actorId: z.string(),
  sessionId: z.string().nullable(),
  project: z.object({
    id: z.string(),
    name: z.string(),
    channelId: z.string(),
  }),
  handle: z
    .object({ name: z.string(), targetId: z.string(), isPrimary: z.boolean() })
    .nullable(),
});
export type ActingIdentity = z.infer<typeof identitySchema>;
export type OperationInput = z.input<typeof operationSchema>;
export interface ActingState {
  projectId: string;
  mode: "browse" | "thread" | "operator";
  threadId: string;
  identity: ActingIdentity | null;
  pending: boolean;
  perform: (request: OperationInput) => Promise<SurfaceResult>;
}
export const ActingContext = createContext<ActingState | null>(null);
export function useActing() {
  const value = useContext(ActingContext);
  if (!value) throw new Error("Radio acting context is missing.");
  return value;
}
