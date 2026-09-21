import { useState } from "react";
import { useBbContext } from "@get-bb/plugin-sdk/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";

import { StackPositionIcon } from "@/components/icons/stack-position.tsx";
import { StackRow } from "./stack-row.tsx";
import { laneWidth } from "./lineage.tsx";
import { useCurrentStack } from "./use-current-stack.ts";

export function StackPanel({ threadId, params }: PluginThreadPanelProps) {
  const context = useBbContext();
  const projectId =
    params !== null &&
    typeof params === "object" &&
    !Array.isArray(params) &&
    typeof params.projectId === "string"
      ? params.projectId
      : context.projectId;
  const { stack, error } = useCurrentStack(projectId, threadId);
  const [openBranches, setOpenBranches] = useState<ReadonlySet<string>>(
    new Set(),
  );

  if (error)
    return (
      <p className="text-sm text-warning-text">
        Unable to load the Graphite stack.
      </p>
    );
  if (stack === null)
    return <p className="text-sm text-muted-foreground">Loading stack…</p>;
  if (stack.outcome === "none" || stack.total < 2)
    return (
      <p className="text-sm text-muted-foreground">
        No Graphite stack for this thread.
      </p>
    );

  const rows = [...stack.branches].reverse();
  const lanes = Math.max(
    0,
    ...rows
      .filter((branch) => openBranches.has(branch.name))
      .map((branch) => laneWidth(branch.offshoots)),
  );

  return (
    <section className="min-w-0 text-xs text-muted-foreground">
      <div className="mb-3 flex items-center gap-2">
        <StackPositionIcon position={stack.placement} className="size-4" />
        <span className="tabular-nums text-sm font-medium text-foreground">
          {stack.position}/{stack.total}
        </span>
        {stack.needsRestack ? (
          <span className="text-warning-text">Needs restack</span>
        ) : null}
      </div>
      {stack.warnings.map((warning) => (
        <p key={warning} className="mb-2 text-warning-text">
          {warning}
        </p>
      ))}
      <ol className="min-w-0">
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
    </section>
  );
}
