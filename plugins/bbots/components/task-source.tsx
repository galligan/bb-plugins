import {
  experimental_FileLink as FileLink,
  experimental_useRpcQuery as useRpcQuery,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { uiContract } from "../lib/ui/contracts.ts";
import { usePageVisible } from "../lib/ui/use-page-visible.ts";
import { Button } from "./ui/button.tsx";
import type { z } from "zod";

type Source = z.infer<typeof uiContract.taskSource.output>;

export function TaskSource({ botId }: { botId: string }) {
  const visible = usePageVisible();
  const query = useRpcQuery({
    contract: uiContract,
    method: "taskSource",
    input: { botId },
    enabled: visible,
  });
  return (
    <TaskSourceSummary
      botId={botId}
      source={query.data}
      loading={query.isLoading}
      readError={Boolean(query.error)}
      visible={visible}
      retry={() => void query.refetch()}
    />
  );
}

export function TaskSourceSummary({
  botId,
  source,
  boardName,
  loading,
  readError,
  visible,
  retry,
  configure = true,
}: {
  botId: string;
  source?: Source;
  boardName?: string | null;
  loading: boolean;
  readError: boolean;
  visible: boolean;
  retry(): void;
  configure?: boolean;
}) {
  const navigate = useBbNavigate();
  const unavailable = readError || source?.availability === "unavailable";
  const changed = source?.availability === "changed-during-read";
  return (
    <div className="space-y-2 text-sm" aria-label="Task source">
      {loading && <p role="status">Reading task source…</p>}
      {(unavailable || changed) && (
        <>
          <p role="status">
            {changed
              ? "Task authority changed during this read. Read the current source again."
              : source?.kind === "markdown"
                ? "The task file is unavailable. Reconnect its machine or restore the original file."
                : "The task source is unavailable. Restore Tasks or its configured board."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!visible}
            onClick={retry}
          >
            Retry task source read
          </Button>
        </>
      )}
      {source?.availability === "unconfigured" && (
        <>
          <p>Task source not configured.</p>
          {configure && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!visible}
              onClick={() =>
                navigate.toPluginPanel("bots", { subPath: `${botId}/settings` })
              }
            >
              Set up task source
            </Button>
          )}
        </>
      )}
      {source?.availability === "recovery-required" && (
        <p role="status">
          Task source setup needs attention. Use Bots task commands to inspect
          and finish its recorded setup.
        </p>
      )}
      {!readError && source?.availability === "available" && source.file && (
        <FileLink
          target={{
            kind: "host",
            hostId: source.file.hostId,
            path: source.file.path,
          }}
          className="underline underline-offset-4"
        >
          Open tasks.md
        </FileLink>
      )}
      {!readError && source?.availability === "available" && source.boardId && (
        <p>
          {boardName
            ? `Tasks board: ${boardName}.`
            : "A Tasks board is configured."}{" "}
          Open Tasks in BB to view its work.
        </p>
      )}
    </div>
  );
}
