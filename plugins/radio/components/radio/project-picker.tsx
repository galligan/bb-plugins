import { useEffect, useState, useId } from "react";
import {
  useSdk,
  useBbNavigate,
  experimental_useTabVisible,
} from "@get-bb/plugin-sdk/app";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select.tsx";
import { Button } from "../ui/button.tsx";
import { ReadStatus } from "./status.tsx";

export function ProjectPicker({ projectId }: { projectId: string }) {
  const fieldId = useId();
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const visible = experimental_useTabVisible();
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    projects: { id: string; name: string }[];
    loading: boolean;
    error: string | null;
  }>({ projects: [], loading: true, error: null });
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    setState((old) => ({ ...old, loading: true, error: null }));
    void sdk.projects
      .list({ signal: abort.signal })
      .then((projects) => {
        if (!abort.signal.aborted)
          setState({
            projects: projects.map(({ id, name }) => ({ id, name })),
            loading: false,
            error: null,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setState((old) => ({
            ...old,
            loading: false,
            error: "Projects are unavailable. Retry to choose a project.",
          }));
      });
    return () => abort.abort();
  }, [sdk, refresh, visible]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={fieldId} className="text-sm font-medium">
          Project
        </label>
        <Select
          value={projectId || undefined}
          onValueChange={(value) =>
            navigate.toPluginPanel("radio", { subPath: value })
          }
        >
          <SelectTrigger id={fieldId} className="w-full sm:w-72">
            <SelectValue placeholder="Choose a project" />
          </SelectTrigger>
          <SelectContent>
            {projectId && !state.projects.some((p) => p.id === projectId) ? (
              <SelectItem value={projectId}>Selected project</SelectItem>
            ) : null}
            {state.projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          disabled={state.loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh projects
        </Button>
      </div>
      <ReadStatus
        loading={state.loading && !state.projects.length}
        refreshing={state.loading && !!state.projects.length}
        error={state.error}
        retry={() => setRefresh((n) => n + 1)}
      />
      {!state.loading && !state.error && !state.projects.length ? (
        <p className="text-sm text-muted-foreground">
          No BB projects are available. Create a project in BB, then refresh.
        </p>
      ) : null}
    </div>
  );
}
