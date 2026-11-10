import { useEffect } from "react";
import { ProjectContainer } from "./project-container.tsx";
import { toast } from "sonner";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";
import { restoreCommand } from "../lib/rescue-schema.ts";
import { CopyButton } from "./copy-button.tsx";
import { EmptyState } from "@/components/ui/empty-state";

type Rescue = z.infer<typeof rpcContract.rescues.output>["projects"][number];
export function RescuedWork({
  rescue,
  hostName,
  projectName,
}: {
  rescue: Rescue;
  hostName: string;
  projectName: string;
}) {
  useEffect(() => {
    if (rescue.error !== null)
      toast.error(`${hostName}: ${rescue.error}`, {
        id: `wt-rescues-${rescue.projectId}-${rescue.hostId}`,
      });
  }, [rescue.error, rescue.projectId, rescue.hostId, hostName]);
  return (
    <ProjectContainer
      projectKey={`rescues:${rescue.projectId}:${rescue.hostId}`}
      title={`Rescued work · ${projectName} · ${hostName}`}
      count={rescue.refs.length}
      noun="refs"
      attention={rescue.error ? 1 : 0}
    >
      {rescue.error && (
        <EmptyState
          icon="AlertTriangle"
          message="Rescue refs could not be read on this machine."
        />
      )}
      <ul className="divide-y divide-border">
        {rescue.refs.map((ref) => (
          <li
            key={ref.ref}
            className="flex min-w-0 items-baseline justify-between gap-3 py-2"
          >
            <div className="min-w-0 space-y-1">
              <p className="text-sm">{ref.subject}</p>
              <p className="text-xs leading-4 text-muted-foreground">
                {new Date(ref.createdAt).toLocaleString()} ·{" "}
                <span className="font-mono">{ref.commit.slice(0, 10)}</span>
              </p>
              <p className="break-all font-mono text-xs leading-4 text-muted-foreground">
                {ref.ref}
              </p>
              <p className="break-all font-mono text-xs leading-4 text-muted-foreground">
                {restoreCommand(ref.ref)}
              </p>
            </div>
            <CopyButton
              text={restoreCommand(ref.ref)}
              label="Copy restore command"
            />
          </li>
        ))}
      </ul>
    </ProjectContainer>
  );
}
