import type { z } from "zod";
import type { rpcContract } from "../server.ts";
import { rowState, sortRows } from "../lib/overview.ts";
import { ProjectContainer } from "./project-container.tsx";
import { WorktreeRow } from "./worktree-row.tsx";

type Overview = z.infer<typeof rpcContract.overview.output>;
export function ProjectWorktrees({
  projectId,
  title,
  data,
  multipleMachines,
  remove,
}: {
  projectId: string;
  title: string;
  data: Overview;
  multipleMachines: boolean;
  remove: (hostId: string, pathKey: string) => Promise<void>;
}) {
  const machines = data.machines.map((machine) => ({
    ...machine,
    worktrees: sortRows(
      machine.worktrees.filter(
        (row) =>
          (row.environment?.projectId ?? row.projectId ?? "unknown") ===
          projectId,
      ),
      Date.now(),
    ),
  }));
  const rows = machines.flatMap((machine) => machine.worktrees);
  if (rows.length === 0) return null;
  const attention = rows.filter(
    (row) => rowState(row, Date.now()).kind === "attention",
  ).length;
  return (
    <ProjectContainer
      projectKey={projectId}
      title={title}
      count={rows.length}
      attention={attention}
    >
      {machines
        .filter((machine) => machine.worktrees.length > 0)
        .map((machine) => (
          <div key={machine.hostId}>
            {multipleMachines && (
              <p className="py-2 text-xs leading-4 text-muted-foreground">
                {machine.name}
              </p>
            )}
            <ul className="divide-y divide-border">
              {machine.worktrees.map((row) => (
                <WorktreeRow
                  key={row.pathKey}
                  row={row}
                  remove={() => remove(machine.hostId, row.pathKey)}
                />
              ))}
            </ul>
          </div>
        ))}
    </ProjectContainer>
  );
}
