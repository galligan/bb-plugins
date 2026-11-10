import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";
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
        if (!stale)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      stale = true;
    };
  }, [rpc]);
  const project = projects?.find((project) => keyOf(project) === selected);
  return (
    <div className="space-y-5 text-foreground">
      {error && <p role="alert">{error}</p>}
      {projects === null && !error && <p role="status">Loading projects…</p>}
      {projects?.length === 0 && (
        <p>No projects with a local checkout on a connected machine.</p>
      )}
      {projects && projects.length > 0 && (
        <label className="block">
          Project
          <select
            className="ml-2 rounded border border-border bg-background p-1"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              try {
                localStorage.setItem("wt:project", event.target.value);
              } catch {
                /* Browser storage is optional. */
              }
            }}
          >
            {projects.map((project) => (
              <option key={keyOf(project)} value={keyOf(project)}>
                {project.name} · {project.hostName}
              </option>
            ))}
          </select>
        </label>
      )}
      {project && (
        <ProjectForm
          key={selected}
          projectId={project.id}
          hostId={project.hostId}
        />
      )}
    </div>
  );
}
