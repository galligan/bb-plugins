import { useState } from "react";
import {
  useBbNavigate,
  experimental_ThreadTitleText as ThreadTitleText,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rowState, type OverviewRow } from "../lib/overview.ts";
import { age } from "../lib/render.ts";
import { branchDescription } from "../lib/display.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CopyButton } from "./copy-button.tsx";
import { WorktreeRemoval } from "./worktree-removal.tsx";

export function WorktreeRow({
  row,
  remove,
}: {
  row: OverviewRow;
  remove: () => Promise<void>;
}) {
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const inspection = row.status === "present" ? row.inspection : null;
  const path = row.status === "present" ? row.inspection.path : row.path;
  const state = rowState(row, Date.now());
  const retry = refused || row.environment?.teardown?.status === "failed";
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await remove();
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRefused(true);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }
  const safety =
    inspection === null
      ? "UNKNOWN"
      : inspection.safeToRemove
        ? "SAFE"
        : "UNSAVED";
  return (
    <li className="flex min-w-0 flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-all text-sm font-medium">
            {inspection?.branch ??
              (inspection === null ? row.pathKey : "(detached)")}
          </span>
          <Badge
            variant={state.kind === "attention" ? "destructive" : "secondary"}
            className="px-1.5 py-0 text-2xs font-normal"
          >
            {state.kind === "attention"
              ? "Needs attention"
              : state.kind === "retiring"
                ? "Retiring"
                : state.kind === "orphaned"
                  ? "Orphaned"
                  : "In use"}
          </Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={inspection?.reasons.length ? 0 : undefined}
                aria-label={
                  inspection?.reasons.length
                    ? `${safety}: ${inspection.reasons.join("; ")}`
                    : safety
                }
              >
                <Badge
                  variant={safety === "UNSAVED" ? "destructive" : "outline"}
                  className="gap-1 px-1.5 py-0 text-2xs font-normal"
                >
                  {safety}
                  {inspection?.reasons.length ? (
                    <Icon name="Info" className="size-3" />
                  ) : null}
                </Badge>
              </span>
            </TooltipTrigger>
            {inspection !== null && inspection.reasons.length > 0 && (
              <TooltipContent>
                <div className="space-y-1">
                  {inspection.reasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              </TooltipContent>
            )}
          </Tooltip>
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <p
            className="truncate font-mono text-xs text-muted-foreground"
            title={path}
          >
            {path}
          </p>
          <CopyButton text={path} label="Copy worktree path" />
        </div>
        {state.badge && (
          <p
            className={`text-xs ${state.kind === "attention" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {state.badge}
          </p>
        )}
        {inspection && (
          <p className="text-xs text-muted-foreground">
            {branchDescription(inspection)} · last activity{" "}
            {age(inspection.lastActivity, Date.now())}
          </p>
        )}
        {row.threads.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            {row.threads.map((thread) => (
              <Button
                key={thread.id}
                variant="ghost"
                size="sm"
                className="h-6 min-w-0 max-w-full justify-start gap-1.5 px-1 text-xs font-normal text-muted-foreground"
                onClick={() => navigate.toThread(thread.id)}
                aria-label={`Open thread: ${thread.title}`}
              >
                <Icon name="MessageSquare" className="size-3.5" />
                <span className="truncate">
                  <ThreadTitleText title={thread.title} />
                </span>
                {thread.archived && (
                  <span className="shrink-0 text-2xs">archived</span>
                )}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
        {row.threads[0] && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={() => navigate.toThread(row.threads[0]!.id)}
          >
            Open thread
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          className="h-7 px-2"
          disabled={busy}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {retry ? "Retry removal" : "Remove"}
        </Button>
      </div>
      <WorktreeRemoval
        row={row}
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        error={error}
        retry={retry}
        confirm={confirm}
      />
    </li>
  );
}
