import { z } from "zod";
import {
  changeSchema,
  idSchema,
  nameSchema,
  revisionSchema,
} from "../storage/schema.ts";
import { defaultsSchema } from "../soul/contracts.ts";

export const checkpointId = z
  .string()
  .refine(
    (value) =>
      value.startsWith("chk_") && z.uuid().safeParse(value.slice(4)).success,
    "Use the stable chk_ ID from checkpoint create/list",
  );
export const createSchema = changeSchema.extend({
  botId: idSchema,
  requestId: z.uuid(),
  name: nameSchema,
});
export const snapshotSchema = z.strictObject({
  profile: z.strictObject({
    botId: idSchema,
    revision: revisionSchema,
    name: nameSchema,
    ...changeSchema.shape,
    createdAt: z.string(),
  }),
  execution: z.strictObject({
    documentId: idSchema.nullable(),
    revision: z.number().int().nonnegative(),
    defaults: defaultsSchema,
    attribution: changeSchema.extend({ createdAt: z.string() }).nullable(),
  }),
});
export const headerSchema = z.strictObject({
  id: checkpointId,
  botId: idSchema,
  name: nameSchema,
  ...changeSchema.shape,
  createdAt: z.string(),
});
export type CreateCheckpoint = z.infer<typeof createSchema>;

export const checkpointMigrations = [
  `CREATE TABLE checkpoints (
    id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(id),
    name TEXT NOT NULL,
    creation_hash TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    author TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE checkpoint_entries (
    checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id),
    document_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    PRIMARY KEY (checkpoint_id,document_id),
    FOREIGN KEY (document_id,revision) REFERENCES document_revisions(document_id,revision)
  )`,
];
