import {
  useComposer,
  useBbNavigate,
  experimental_useRpcKeyedQuery as useRpcKeyedQuery,
  experimental_DetailRow as DetailRow,
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import { uiContract } from "../lib/ui/contracts.ts";
import { usePageVisible } from "../lib/ui/use-page-visible.ts";
import { ResourceActionButton } from "./ui/resource/row.tsx";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "./ui/coarse-pointer-sizing.ts";

function useOwner(threadId: string | null) {
  const visible = usePageVisible();
  const query = useRpcKeyedQuery({
    contract: uiContract,
    method: "ownership",
    keys: threadId ? [threadId] : [],
    enabled: visible && threadId !== null,
  });
  // Never use a previous scope's owner or expose a stale action after a failed read.
  return visible && threadId && !query.error
    ? (query.data?.[threadId] ?? null)
    : null;
}

export function BotComposerSettings() {
  const composer = useComposer();
  const owner = useOwner(
    composer.scope.kind === "thread" ? composer.scope.threadId : null,
  );
  const navigate = useBbNavigate();
  return owner ? (
    <ResourceActionButton
      label={`Bot settings for @${owner.name}`}
      icon="Bot"
      className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
      onClick={() =>
        navigate.toPluginPanel("bots", { subPath: `${owner.botId}/settings` })
      }
    />
  ) : null;
}

export function BotInfoRow({ threadId }: ExperimentalThreadInfoProps) {
  const owner = useOwner(threadId);
  const navigate = useBbNavigate();
  return owner ? (
    <DetailRow icon="Bot" label="Bot">
      <button
        type="button"
        className="cursor-pointer truncate text-left hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={`Bot settings for @${owner.name}`}
        onClick={() =>
          navigate.toPluginPanel("bots", { subPath: `${owner.botId}/settings` })
        }
      >
        @{owner.name} · {owner.role === "main" ? "Main" : "Worker"}
      </button>
    </DetailRow>
  ) : null;
}

export function BotContextCardRow({ threadId }: ExperimentalThreadInfoProps) {
  const owner = useOwner(threadId);
  const navigate = useBbNavigate();
  return owner ? (
    <ThreadContextCardRow
      icon="Bot"
      label={`@${owner.name}`}
      trailing={owner.role === "main" ? "Main" : "Worker"}
      title={`Bot settings for @${owner.name}`}
      onClick={() =>
        navigate.toPluginPanel("bots", { subPath: `${owner.botId}/settings` })
      }
    />
  ) : null;
}
