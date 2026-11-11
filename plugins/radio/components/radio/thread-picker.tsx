import { useRadioVisible } from "./use-radio-visible.ts";
import { choiceLabels } from "./choice-labels.ts";
import { useEffect, useId, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select.tsx";
import { Button } from "../ui/button.tsx";
import { ReadStatus } from "./status.tsx";

export function ThreadPicker({
  projectId,
  value,
  onChange,
  disabled,
}: {
  projectId: string;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const sdk = useSdk();
  const visible = useRadioVisible();
  const fieldId = useId();
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    items: { id: string; title: string | null }[];
    loading: boolean;
    hasMore: boolean;
    error: string | null;
  }>({ items: [], loading: true, hasMore: false, error: null });
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    setState((old) => ({ ...old, loading: true, error: null }));
    void sdk.threads
      .list({
        projectId,
        archived: false,
        includeHidden: false,
        limit: 51,
        offset,
        signal: abort.signal,
      })
      .then((items) => {
        if (!abort.signal.aborted)
          setState({
            items: items.slice(0, 50).map(({ id, title }) => ({ id, title })),
            loading: false,
            hasMore: items.length > 50,
            error: null,
          });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setState((old) => ({
            ...old,
            loading: false,
            error:
              "Threads are unavailable. Retry or remain in browse-only mode.",
          }));
      });
    return () => abort.abort();
  }, [sdk, projectId, visible, offset, refresh]);
  const choices = choiceLabels(
    state.items.map((item) => ({ id: item.id, name: item.title })),
    "Untitled thread",
  );
  return (
    <div className="space-y-2">
      <label htmlFor={fieldId} className="text-sm font-medium">
        Acting BB thread
      </label>
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={disabled || state.loading}
      >
        <SelectTrigger id={fieldId} className="w-full sm:max-w-lg">
          <SelectValue placeholder="Choose a thread explicitly" />
        </SelectTrigger>
        <SelectContent>
          {value && !state.items.some((t) => t.id === value) ? (
            <SelectItem value={value}>Selected thread · {value}</SelectItem>
          ) : null}
          {choices.map((thread) => (
            <SelectItem key={thread.id} value={thread.id}>
              {thread.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ReadStatus
        loading={state.loading && !state.items.length}
        refreshing={state.loading && !!state.items.length}
        error={state.error}
        retry={() => setRefresh((n) => n + 1)}
      />
      {!state.loading && !state.error && !state.items.length ? (
        <p className="text-sm text-muted-foreground">
          No active threads on this page.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || state.loading || offset === 0}
          onClick={() => setOffset((n) => Math.max(0, n - 50))}
        >
          Previous threads
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || state.loading || !state.hasMore}
          onClick={() => setOffset((n) => n + 50)}
        >
          Next threads
        </Button>
      </div>
    </div>
  );
}
