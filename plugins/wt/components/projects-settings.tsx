import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { SettingsGroup, SettingsRow } from "./settings-row.tsx";
import { Loading } from "./loading.tsx";
import { ProjectForm } from "./project-form.tsx";
type Project = z.infer<typeof rpcContract.projects.output>[number];
const keyOf = (project: Project) => `${project.id}:${project.hostId}`;
export function ProjectsSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    rpc
      .call("projects", {})
      .then((projects) => {
        if (stale) return;
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem("wt:project");
        } catch {
          /* Browser storage is optional. */
        }
        setProjects(projects);
        setSelected(
          projects.some((project) => keyOf(project) === remembered)
            ? (remembered ?? "")
            : projects[0]
              ? keyOf(projects[0])
              : "",
        );
      })
      .catch((error) => {
        if (!stale) {
          const message =
            error instanceof Error ? error.message : String(error);
          setError(message);
          toast.error(message);
        }
      });
    return () => {
      stale = true;
    };
  }, [rpc]);
  const project = projects?.find((project) => keyOf(project) === selected);
  return (
    <TooltipProvider>
      <div className="space-y-4 text-foreground">
        {error && <EmptyState icon="AlertTriangle" message={error} />}
        {projects === null && !error && <Loading label="Loading projects…" />}
        {projects?.length === 0 && (
          <EmptyState
            icon="FolderGit"
            message="No projects with a local checkout on a connected machine."
          />
        )}
        {projects && projects.length > 0 && (
          <SettingsGroup>
            <SettingsRow
              label="Project"
              htmlFor="wt-project"
              description="Settings for a local checkout on a connected machine."
            >
              <Select
                value={selected}
                onValueChange={(next) => {
                  setSelected(next);
                  try {
                    localStorage.setItem("wt:project", next);
                  } catch {
                    /* Browser storage is optional. */
                  }
                }}
              >
                <SelectTrigger
                  id="wt-project"
                  className="h-7 w-full text-xs @min-[36rem]/settings:w-64"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={keyOf(project)} value={keyOf(project)}>
                      {project.name} · {project.hostName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsGroup>
        )}
        {project && (
          <ProjectForm
            key={selected}
            projectId={project.id}
            hostId={project.hostId}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
