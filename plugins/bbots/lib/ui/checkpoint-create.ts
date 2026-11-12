import type { PluginStorage } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import type { Checkpoints } from "../checkpoints/store.ts";
import { recordIdentity } from "./record-identity.ts";
import { checkpointUiContract } from "./checkpoint-contracts.ts";

export function createCheckpointAction(
  storage: PluginStorage,
  store: SetupStore,
  checkpoints: Checkpoints,
  changed: () => void,
) {
  return (
    input: z.input<typeof checkpointUiContract.botCheckpointCreate.input>,
  ) => {
    const value = checkpointUiContract.botCheckpointCreate.input.parse(input);
    const result = storage
      .database()
      .transaction(() => {
        const identity = recordIdentity(store, value.threadId);
        if (identity.botId !== value.expectedBotId)
          throw new Error(
            "Conversation ownership differs from the selected bot. Reopen its records before creating a checkpoint.",
          );
        const found = checkpoints.create({
          botId: identity.botId,
          requestId: value.requestId,
          name: value.name,
          reason: value.reason,
          author: "user:bot-records",
        });
        return checkpointUiContract.botCheckpointCreate.output.parse({
          checkpoint: found.checkpoint,
          replay: found.replay,
        });
      })
      .immediate();
    changed();
    return result;
  };
}
