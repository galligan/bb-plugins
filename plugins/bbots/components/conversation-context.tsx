import {
  useComposer,
  useBbNavigate,
  experimental_DetailRow as DetailRow,
  experimental_ThreadContextCardRow as ThreadContextCardRow,
  type ExperimentalThreadInfoProps,
} from "@get-bb/plugin-sdk/app";
import { useConversationOwner } from "../lib/ui/use-owner.ts";
import { ResourceActionButton } from "./ui/resource/row.tsx";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "./ui/coarse-pointer-sizing.ts";

function useOwner(threadId: string | null) {
  const { owner, visible } = useConversationOwner(threadId);
  return visible ? owner : null;
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
