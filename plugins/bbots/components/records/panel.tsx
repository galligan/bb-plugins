import { useState } from "react";
import {
  experimental_useAppPanel as useAppPanel,
  experimental_useTabVisible as useTabVisible,
  experimental_DetailRow as DetailRow,
  type ExperimentalThreadInfoProps,
  type ExperimentalThreadTabProps,
} from "@get-bb/plugin-sdk/app";
import { useConversationOwner } from "../../lib/ui/use-owner.ts";
import { RecordsBrowser } from "./browser.tsx";
import { Button } from "../ui/button.tsx";

export const recordsTab = {
  id: "bot-records",
  context: { kind: "thread" },
  availability: "fixed",
} as const;

export function useRecordsVisible({ threadId }: ExperimentalThreadTabProps) {
  // A retained tab can show its ownership retry state without exposing data.
  return useConversationOwner(threadId).knownOwner !== null;
}

export function BotRecordsInfo({ threadId }: ExperimentalThreadInfoProps) {
  const { owner, visible } = useConversationOwner(threadId);
  const panel = useAppPanel(),
    [declined, setDeclined] = useState(false);
  if (!owner || !visible) return null;
  return (
    <DetailRow icon="BookOpen" label="Bot records">
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDeclined(!panel.openTab({ tab: recordsTab }))}
        >
          Inspect bot records
        </Button>
        {declined && (
          <p role="status" className="mt-1 text-xs text-muted-foreground">
            This surface could not open Bot records. Select it from this
            conversation's native panel tabs.
          </p>
        )}
      </div>
    </DetailRow>
  );
}

export function BotRecordsPanel({ threadId }: ExperimentalThreadTabProps) {
  const { owner, visible, query } = useConversationOwner(threadId);
  const tabVisible = useTabVisible();
  if (query.error)
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>Could not verify this conversation's bot ownership.</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!visible || !tabVisible}
          onClick={() => void query.refetch()}
        >
          Retry ownership read
        </Button>
      </div>
    );
  if (!owner)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {query.isLoading
          ? "Reading bot ownership…"
          : "Open Bot records from an owned main or worker conversation."}
      </p>
    );
  return (
    <RecordsBrowser
      key={threadId}
      threadId={threadId}
      botId={owner.botId}
      name={owner.name}
      active={visible && tabVisible}
    />
  );
}
