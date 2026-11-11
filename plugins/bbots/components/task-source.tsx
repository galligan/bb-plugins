import {
  experimental_FileLink as FileLink,
  experimental_useRpcQuery as useRpcQuery,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { uiContract } from "../lib/ui/contracts.ts";
import { usePageVisible } from "../lib/ui/use-page-visible.ts";
import { Button } from "./ui/button.tsx";

export function TaskSource({ botId }: { botId: string }) {
  const visible = usePageVisible();
  const navigate = useBbNavigate();
  const query = useRpcQuery({
    contract: uiContract,
    method: "taskSource",
    input: { botId },
    enabled: visible,
  });
  const source = query.data;
  const unavailable = query.error || source?.availability === "unavailable";
  return (
    <div className="space-y-2 text-sm" aria-label="Task source">
      {query.isLoading && <p role="status">Reading task source…</p>}
      {unavailable && (
        <>
          <p role="status">
            {source?.kind === "markdown"
              ? "The task file is unavailable. Reconnect its machine or restore the original file."
              : "The task source is unavailable. Restore Tasks or its configured board."}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!visible}
            onClick={() => void query.refetch()}
          >
            Retry task source read
          </Button>
        </>
      )}
      {source?.availability === "unconfigured" && (
        <p>Task source not configured.</p>
      )}
      {source?.availability === "recovery-required" && (
        <p role="status">
          Task source setup needs attention. Use Bots task commands to inspect
          and finish its recorded setup.
        </p>
      )}
      {source?.availability === "available" && source.file && (
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
      {source?.availability === "available" && source.boardId && (
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            navigate.toPluginPanel("tasks", {
              subPath: `${encodeURIComponent(source.boardId!)}?view=board`,
            })
          }
        >
          Open Tasks board
        </Button>
      )}
    </div>
  );
}
