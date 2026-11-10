import { useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { rowState, type OverviewRow } from "../lib/overview.ts";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CopyButton } from "./copy-button.tsx";
import { RowAction } from "./row-action.tsx";
import { WorktreeMetadata } from "./worktree-metadata.tsx";
import { WorktreeRemoval } from "./worktree-removal.tsx";

export function WorktreeRow({
  row,
  remove,
}: {
  row: OverviewRow;
  remove: () => Promise<void>;
}) {
  const navigate = useBbNavigate();
  const removeButton = useRef<HTMLButtonElement>(null);
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
  const reasons = [
    ...(state.badge ? [state.badge] : []),
    ...(inspection?.reasons ?? []),
  ];
  return (
    <li
      data-wt-row
      className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 py-3"
    >
      <div
        className="flex min-h-7 min-w-0 items-baseline gap-2 max-md:pointer-coarse:min-h-9"
        data-wt-title
      >
        <span className="min-w-0 truncate text-sm font-medium leading-7 max-md:pointer-coarse:leading-9">
          {inspection?.branch ??
            (inspection === null ? row.pathKey : "(detached)")}
        </span>
        {state.kind !== "in-use" && (
          <Badge
            variant="outline"
            className="shrink-0 px-1.5 py-0 text-2xs font-normal leading-4"
          >
            {state.kind === "attention"
              ? "Needs attention"
              : state.kind === "retiring"
                ? "Retiring"
                : "Orphaned"}
          </Badge>
        )}
        {inspection && !inspection.safeToRemove && (
          <Badge
            variant="outline"
            className="shrink-0 px-1.5 py-0 text-2xs font-normal leading-4"
          >
            UNSAVED
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {row.threads[0] && (
          <RowAction
            label="Open thread"
            icon="ExternalLink"
            onClick={() => navigate.toThread(row.threads[0]!.id)}
          />
        )}
        <RowAction
          ref={removeButton}
          label="Remove worktree"
          icon="Trash2"
          destructive
          disabled={busy}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        />
        {retry && (
          <RowAction
            label="Retry removal"
            icon="RotateCcw"
            disabled={busy}
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          />
        )}
      </div>
      <div className="col-span-2 min-w-0 space-y-0.5">
        <WorktreeMetadata row={row} />
        <div className="flex h-6 max-md:pointer-coarse:h-9 min-w-0 items-center gap-1 text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <p
                tabIndex={0}
                className="min-w-0 truncate font-mono text-xs leading-4"
              >
                {path}
              </p>
            </TooltipTrigger>
            <TooltipContent className="max-w-[calc(100vw-2rem)] break-all">
              {path}
            </TooltipContent>
          </Tooltip>
          <span className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <CopyButton text={path} label="Copy worktree path" />
          </span>
        </div>
        {reasons.length > 0 && (
          <p className="text-xs leading-4 text-muted-foreground">
            {reasons.join(" · ")}
          </p>
        )}
      </div>
      <WorktreeRemoval
        row={row}
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        error={error}
        retry={retry}
        confirm={confirm}
        restoreFocus={() => removeButton.current?.focus()}
      />
    </li>
  );
}
