import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  experimental_useRpcQuery as useRpcQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import {
  soulContract,
  defaultsStateSchema,
  type ExecutionDefaults,
} from "../../lib/soul/contracts.ts";
import { ExecutionChoice, type Choice } from "../execution-choice.tsx";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { SettingsGroup } from "./layout.tsx";

function summary(value: ExecutionDefaults["main"] | null, inherited: string) {
  if (value === null || Object.keys(value).length === 0) return inherited;
  return [
    value.providerId ?? "BB provider",
    value.model ?? "Default model",
    value.reasoningLevel,
    value.permissionMode ?? "BB permission policy",
  ]
    .filter(Boolean)
    .join(" · ");
}
function DefaultsEditor({
  botId,
  hostId,
  state,
  reread,
}: {
  botId: string;
  hostId: string;
  state: z.infer<typeof defaultsStateSchema>;
  reread(): void;
}) {
  const [base, setBase] = useState(state);
  const [main, setMain] = useState(state.defaults.main),
    [worker, setWorker] = useState(state.defaults.worker);
  const [editMain, setEditMain] = useState(false),
    [editWorker, setEditWorker] = useState(false);
  const [choosingMain, setChoosingMain] = useState(false),
    [choosingWorker, setChoosingWorker] = useState(false);
  const [saved, setSaved] = useState(false);
  const mutation = useRpcMutation({
    contract: soulContract,
    method: "defaultsUpdate",
  });
  const dirty =
    JSON.stringify({ main, worker }) !==
    JSON.stringify({ main: base.defaults.main, worker: base.defaults.worker });
  useEffect(() => {
    if (!dirty && state.revision >= base.revision) {
      setBase(state);
      setMain(state.defaults.main);
      setWorker(state.defaults.worker);
    }
  }, [state, base.revision, dirty]);
  const changeMain = useCallback((choice: Choice | null) => {
    setMain(choice ?? {});
    setSaved(false);
  }, []);
  const changeWorker = useCallback((choice: Choice | null) => {
    setWorker(choice ?? {});
    setSaved(false);
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || mutation.isPending) return;
    try {
      const result = await mutation.mutate({
        botId,
        expectedRevision: base.revision,
        defaults: { main, worker, fallback: base.defaults.fallback },
        author: "user:bot-settings",
        reason: "Explicit future execution defaults save in bot settings",
      });
      setBase(result);
      setMain(result.defaults.main);
      setWorker(result.defaults.worker);
      setSaved(true);
      reread();
    } catch {
      setSaved(false);
    }
  }
  function discard() {
    setMain(base.defaults.main);
    setWorker(base.defaults.worker);
    setEditMain(false);
    setEditWorker(false);
    setChoosingMain(false);
    setChoosingWorker(false);
    mutation.reset();
    reread();
  }
  return (
    <form onSubmit={(event) => void save(event)}>
      <fieldset disabled={mutation.isPending} className="space-y-4">
        <legend className="sr-only">Future execution defaults</legend>
        <div className="space-y-2">
          <h3 className="text-sm">Main conversations</h3>
          <p className="text-xs text-muted-foreground">
            {summary(main, "Use BB defaults")}
          </p>
          {editMain ? (
            <ExecutionChoice
              key={`main:${base.revision}`}
              hostId={hostId}
              initial={main}
              label="Choose main defaults"
              onChoosing={setChoosingMain}
              onChange={changeMain}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditMain(true)}
            >
              Change main defaults
            </Button>
          )}
          {Object.keys(main).length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setMain({});
                setEditMain(false);
                setChoosingMain(false);
              }}
            >
              Use BB defaults
            </Button>
          )}
        </div>
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm">Worker conversations</h3>
          <p className="text-xs text-muted-foreground">
            {summary(
              worker,
              worker === null
                ? "Inherit main defaults"
                : "Independent BB defaults",
            )}
          </p>
          {editWorker ? (
            <ExecutionChoice
              key={`worker:${base.revision}`}
              hostId={hostId}
              initial={worker ?? undefined}
              label="Choose independent worker defaults"
              onChoosing={setChoosingWorker}
              onChange={changeWorker}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditWorker(true)}
            >
              Change worker defaults
            </Button>
          )}
          {worker !== null && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setWorker(null);
                setEditWorker(false);
                setChoosingWorker(false);
              }}
            >
              Inherit main defaults
            </Button>
          )}
          {(worker === null || Object.keys(worker).length > 0) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setWorker({});
                setEditWorker(false);
                setChoosingWorker(false);
              }}
            >
              Use independent BB defaults
            </Button>
          )}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Automatic fallback is disabled. Any stored fallback preference is
          retained; saving here does not activate it.
        </p>
        {mutation.error && (
          <p role="alert" className="text-xs text-destructive">
            Could not confirm the defaults save. Your draft is kept; read the
            saved version before trying again.
          </p>
        )}
        {saved && !dirty && (
          <p role="status" className="text-xs text-muted-foreground">
            Future conversation defaults saved.
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {mutation.error && (
            <Button type="button" variant="outline" size="sm" onClick={discard}>
              Discard draft and read saved defaults
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            disabled={
              !dirty ||
              mutation.isPending ||
              (choosingMain && Object.keys(main).length === 0) ||
              (choosingWorker &&
                (worker === null || Object.keys(worker).length === 0))
            }
          >
            {mutation.isPending ? "Saving…" : "Save defaults"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
export function DefaultSettings({
  botId,
  hostId,
}: {
  botId: string;
  hostId: string;
}) {
  const query = useRpcQuery({
    contract: soulContract,
    method: "defaultsShow",
    input: { botId },
  });
  return (
    <SettingsGroup
      title="Execution defaults"
      description="For future conversations only. Existing conversations keep their native current-thread controls."
    >
      {query.isLoading && <Skeleton className="h-24 w-full" />}
      {query.error && (
        <div role="alert">
          <p className="text-xs text-destructive">
            Could not read execution defaults.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry defaults read
          </Button>
        </div>
      )}
      {query.data && (
        <DefaultsEditor
          botId={botId}
          hostId={hostId}
          state={query.data}
          reread={() => void query.refetch()}
        />
      )}
    </SettingsGroup>
  );
}
