import { defineRpcContract, type PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import type { MemoryStore } from "../memory/store.ts";
import { memoryId } from "../memory/contracts.ts";
import { idSchema, nameSchema } from "../storage/schema.ts";
import { recordIdentity } from "./record-identity.ts";

export const memoryForgetContract = defineRpcContract({
  botMemoryForget: {
    input: z.strictObject({
      threadId: idSchema,
      expectedBotId: idSchema,
      id: memoryId,
      expectedRevision: z.number().int().positive(),
      confirm: z.literal(true),
    }),
    output: z.strictObject({
      threadId: idSchema,
      botId: idSchema,
      name: nameSchema,
      id: memoryId,
      availability: z.literal("suppressed"),
    }),
  },
});

export function createMemoryForget(
  storage: PluginStorage,
  store: SetupStore,
  memory: MemoryStore,
) {
  return (
    input: z.input<typeof memoryForgetContract.botMemoryForget.input>,
  ) => {
    const value = memoryForgetContract.botMemoryForget.input.parse(input);
    return storage
      .database()
      .transaction(() => {
        const identity = recordIdentity(store, value.threadId);
        if (identity.botId !== value.expectedBotId)
          throw new Error(
            "Conversation ownership differs from the selected bot. Reopen its records before forgetting memory.",
          );
        const result = memory.forget(
          identity.botId,
          value.id,
          value.expectedRevision,
          "user:bot-records",
        );
        return memoryForgetContract.botMemoryForget.output.parse({
          ...identity,
          id: result.id,
          availability: result.availability,
        });
      })
      .immediate();
  };
}
