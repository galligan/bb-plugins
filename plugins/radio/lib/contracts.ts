import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export type Database = ReturnType<BbPluginApi["storage"]["database"]>;
export const idSchema = z.string().min(1).max(256);
export const metadataSchema = z
  .object({
    name: z.string().max(256).optional(),
    tool: z.string().max(256).optional(),
    provider: z.string().max(256).optional(),
    model: z.string().max(256).optional(),
  })
  .strict();
export type SessionMetadata = z.infer<typeof metadataSchema>;
export const externalReportSchema = metadataSchema
  .extend({ sessionId: idSchema.optional() })
  .strict();

export interface Participant {
  stationId: string;
  id: string;
  kind: "human" | "actor" | "bb-thread" | "external-session";
  actorId: string | null;
  principalId: string | null;
  externalId: string | null;
  metadata: SessionMetadata;
  provenance: "station" | "bb" | "self-reported";
}

export interface Project {
  id: string;
  name: string;
  channelId: string;
}

export interface Channel {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
}

/** Adapter-established authority, never a self-report. The initial no-credential test principal represents deployment trust, not independent external authentication. */
export type TrustedCaller =
  | { kind: "human"; actorId: string }
  | { kind: "actor"; actorId: string }
  | { kind: "principal"; principalId: string };

export interface Handle {
  projectId: string;
  name: string;
  targetId: string;
  isPrimary: boolean;
}
