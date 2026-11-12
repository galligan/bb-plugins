import type { SetupStore } from "../setup/storage.ts";

export function recordIdentity(store: SetupStore, threadId: string) {
  const conversation = store.conversations.ownerOfThread(threadId);
  if (!conversation)
    throw new Error(
      "This conversation is not owned by Bots. Open records from an owned main or worker.",
    );
  const bot = store.profiles.get(conversation.botId);
  return { threadId, botId: bot.id, name: bot.name };
}
