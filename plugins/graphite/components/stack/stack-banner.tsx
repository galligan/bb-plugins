// The composer banner: one row above the prompt when there is a stack to report,
// nothing at all when there is not.

import { useEffect, useState } from "react";
import { useBbContext, useRpc } from "@get-bb/plugin-sdk/app";

import { Icon } from "@/components/ui/icon";
import { StackPositionIcon } from "@/components/icons/stack-position.tsx";
import { StackRow } from "./stack-row.tsx";
import { laneWidth } from "./lineage.tsx";
import type { rpcContract } from "@/server";
import type { CurrentStack } from "@/lib/current-stack.ts";
import { cn } from "@/lib/utils";

/**
 * The quiet default: one row above the composer, only when there is a stack to
 * report. `chrome: "card"` gives it the same bounding BB's own diff bar uses, so
 * the two rows line up; the inner classes mirror that bar's as well.
 *
 * Renders null when there is no stack, which collapses BB's banner region to
 * zero height.
 */
export function StackBanner() {
  const rpc = useRpc<typeof rpcContract>();
  const { projectId, threadId } = useBbContext();
  const [stack, setStack] = useState<CurrentStack | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [openBranches, setOpenBranches] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (projectId === null) {
      setStack(null);
      return;
    }
    setStack(null);
    let live = true;
    let pending = false;
    const refresh = async () => {
      if (!live || pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await rpc.call("stack_current", { projectId, threadId });
        if (live) setStack(result);
      } catch {
        if (live) setStack(null);
      } finally {
        pending = false;
      }
    };
    void refresh();
    // `gt` can change metadata without changing the route or remounting this banner.
    const timer = window.setInterval(() => void refresh(), 15_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [rpc, projectId, threadId]);

  if (stack === null || stack.outcome !== "stacked") return null;

  // Sentence case, so the row always opens on a capital the way BB's own do.
  let state: string | null = null;
  if (stack.warnings.length > 0) state = "Metadata changed";
  else if (stack.needsRestack) state = "Needs restack";
  else if (stack.isStale) state = "Drifted";
  // Tip first, the way `gt ls` prints it: trunk is the last line, not the first.
  const rows = [...stack.branches].reverse();
  // One lane width for every row, so branch names line up whether or not the row
  // has columns beside it — the way `gt ls` keeps a single name column.
  const lanes = Math.max(
    0,
    ...rows
      .filter((branch) => openBranches.has(branch.name))
      .map((branch) => laneWidth(branch.offshoots)),
  );

  return (
    // Structure copied from BB's own diff bar so the two rows share a baseline:
    // a p-1 wrapper, then a min-h-6 px-2 py-1 button. That is what puts our icon
    // at the same x as theirs and makes both cards the same height.
    <div className="text-xs text-muted-foreground">
      <div className="flex items-center gap-0.5 p-1">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="flex min-h-6 min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-state-hover"
        >
          <StackPositionIcon position={stack.placement} className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate tabular-nums">
            {stack.position}/{stack.total}
          </span>
          {state !== null ? (
            <span className="shrink-0 text-warning-text">{state}</span>
          ) : null}
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        </button>
      </div>
      <div
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows,opacity,border-color] duration-200 ease-out",
          expanded
            ? "grid-rows-[1fr] border-t border-border opacity-100"
            : "pointer-events-none grid-rows-[0fr] border-t border-transparent opacity-0",
        )}
      >
        <div className="overflow-hidden rounded-b-[7px] bg-popover">
          <ol className="max-h-72 overflow-auto p-1">
            {stack.warnings.map((warning) => (
              <li key={warning} className="px-2 py-1 text-warning-text">{warning}</li>
            ))}
            {rows.map((branch, index) => (
              <StackRow
                key={branch.name}
                branch={branch}
                first={index === 0}
                last={index === rows.length - 1}
                open={openBranches.has(branch.name)}
                onToggle={() =>
                  setOpenBranches((current) => {
                    const next = new Set(current);
                    if (next.has(branch.name)) next.delete(branch.name);
                    else next.add(branch.name);
                    return next;
                  })
                }
                laneWidth={lanes}
              />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
