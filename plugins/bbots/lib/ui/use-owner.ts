import { experimental_useRpcKeyedQuery as useRpcKeyedQuery } from "@get-bb/plugin-sdk/app";
import { uiContract } from "./contracts.ts";
import { usePageVisible } from "./use-page-visible.ts";

export function useConversationOwner(threadId: string | null) {
  const visible = usePageVisible();
  const query = useRpcKeyedQuery({
    contract: uiContract,
    method: "ownership",
    keys: threadId ? [threadId] : [],
    enabled: visible && threadId !== null,
  });
  // Keyed lookup prevents a prior pane's owner from authorizing this scope.
  // Retain a matching cached identity while hidden so tab visibility alone
  // cannot remove the user's selected native tab. Content gates separately.
  const knownOwner = threadId ? (query.data?.[threadId] ?? null) : null;
  const owner = query.error ? null : knownOwner;
  return { owner, knownOwner, visible, query };
}
