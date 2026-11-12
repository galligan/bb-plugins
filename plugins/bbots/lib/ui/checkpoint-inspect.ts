import { defineRpcContract, type PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { checkpointId, headerSchema } from "../checkpoints/contracts.ts";
import type { Checkpoints } from "../checkpoints/store.ts";
import type { SetupStore } from "../setup/storage.ts";
import { changeSchema, idSchema, nameSchema } from "../storage/schema.ts";
import { recordIdentity } from "./record-identity.ts";

export const checkpointInspectContract = defineRpcContract({
  botCheckpoint: {
    input: z.strictObject({
      threadId: idSchema,
      expectedBotId: idSchema,
      id: checkpointId,
      after: idSchema.optional(),
    }),
    output: z.strictObject({
      threadId: idSchema,
      botId: idSchema,
      name: nameSchema,
      checkpoint: headerSchema,
      profile: z.strictObject({
        name: nameSchema,
        revision: z.number().int().positive(),
      }),
      selectedDocuments: z.number().int().nonnegative(),
      after: idSchema.nullable(),
      document: z
        .strictObject({
          id: idSchema,
          revision: z.number().int().positive(),
          ...changeSchema.shape,
          createdAt: z.string(),
          kind: z.enum(["soul", "knowledge"]),
          topic: z.string().max(128),
          markdown: z.string().max(65_536),
          basis: z.enum(["fact", "inference"]).nullable(),
          sources: z.array(z.string().max(320)).max(20),
          sourceCount: z.number().int().nonnegative(),
        })
        .nullable(),
      nextCursor: idSchema.nullable(),
    }),
    tags: () => ["bots"],
  },
});

export function createCheckpointInspector(
  storage: PluginStorage,
  store: SetupStore,
  checkpoints: Checkpoints,
) {
  return (
    input: z.input<typeof checkpointInspectContract.botCheckpoint.input>,
  ) => {
    const value = checkpointInspectContract.botCheckpoint.input.parse(input);
    return storage.database().transaction(() => {
      const identity = recordIdentity(store, value.threadId);
      if (identity.botId !== value.expectedBotId)
        throw new Error(
          "Conversation ownership changed. Reopen its records before inspecting a checkpoint.",
        );
      const page = checkpoints.page(identity.botId, value.id, value.after);
      const doc = page.document;
      return checkpointInspectContract.botCheckpoint.output.parse({
        ...identity,
        checkpoint: page.checkpoint,
        profile: { name: page.profile.name, revision: page.profile.revision },
        selectedDocuments: page.selectedDocuments,
        after: value.after ?? null,
        document: doc
          ? {
              id: doc.id,
              revision: doc.revision,
              author: doc.author,
              reason: doc.reason,
              createdAt: doc.createdAt,
              kind: doc.kind,
              topic: doc.kind === "soul" ? "SOUL.md" : doc.record.topic,
              markdown:
                doc.kind === "soul" ? doc.markdown : doc.record.markdown,
              basis: doc.kind === "soul" ? null : doc.record.basis,
              sourceCount: doc.kind === "soul" ? 0 : doc.record.sources.length,
              sources:
                doc.kind === "soul"
                  ? []
                  : doc.record.sources
                      .slice(0, 20)
                      .map((source) =>
                        typeof source === "string"
                          ? source
                          : `${source.streamId} · ${source.from}–${source.through}`,
                      ),
            }
          : null,
        nextCursor: page.nextCursor,
      });
    })();
  };
}
