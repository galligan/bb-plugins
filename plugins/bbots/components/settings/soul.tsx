import { useEffect, useId, useState, type FormEvent } from "react";
import {
  experimental_useRpcQuery as useRpcQuery,
  experimental_useRpcMutation as useRpcMutation,
} from "@get-bb/plugin-sdk/app";
import type { z } from "zod";
import { soulContract, soulStateSchema } from "../../lib/soul/contracts.ts";
import { Textarea } from "../ui/textarea.tsx";
import { Button } from "../ui/button.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { SettingsGroup } from "./layout.tsx";

function SoulEditor({
  botId,
  state,
  reread,
}: {
  botId: string;
  state: z.infer<typeof soulStateSchema>;
  reread(): void;
}) {
  const inputId = useId();
  const [base, setBase] = useState(state),
    [markdown, setMarkdown] = useState(state.current?.markdown ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = markdown !== (base.current?.markdown ?? "");
  const mutation = useRpcMutation({
    contract: soulContract,
    method: "soulUpdate",
  });
  useEffect(() => {
    if (
      !dirty &&
      (state.current?.revision ?? 0) >= (base.current?.revision ?? 0)
    ) {
      setBase(state);
      setMarkdown(state.current?.markdown ?? "");
    }
  }, [state, base.current?.revision, dirty]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || !markdown.trim() || mutation.isPending) return;
    try {
      const result = await mutation.mutate({
        botId,
        expectedRevision: base.current?.revision ?? 0,
        markdown,
        author: "user:bot-settings",
        reason: "Explicit SOUL save in bot settings",
      });
      setBase(result);
      setMarkdown(result.current?.markdown ?? "");
      setSaved(true);
      reread();
    } catch {
      setSaved(false);
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} className="space-y-3">
      <label htmlFor={inputId} className="sr-only">
        SOUL.md
      </label>
      <Textarea
        id={inputId}
        disabled={mutation.isPending}
        value={markdown}
        maxLength={16000}
        rows={8}
        className="resize-y"
        onChange={(event) => {
          setMarkdown(event.target.value);
          setSaved(false);
        }}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        Saved revision {state.current?.revision ?? "none"} · Last supplied{" "}
        {state.lastSuppliedRevision ?? "none"} · Applied revision unknown.
      </p>
      <p className="text-xs leading-5 text-muted-foreground">
        An existing conversation may retain older instructions. Saving starts no
        turn and does not refresh its session.
      </p>
      {mutation.error && (
        <p role="alert" className="text-xs text-destructive">
          Could not confirm the SOUL save. Your draft is kept; read the saved
          version before trying again.
        </p>
      )}
      {saved && (
        <p role="status" className="text-xs text-muted-foreground">
          SOUL saved.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {mutation.error && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setMarkdown(base.current?.markdown ?? "");
              mutation.reset();
              reread();
            }}
          >
            Discard draft and read saved SOUL
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={!dirty || !markdown.trim() || mutation.isPending}
        >
          {mutation.isPending ? "Saving…" : "Save SOUL"}
        </Button>
      </div>
    </form>
  );
}
export function SoulSettings({ botId }: { botId: string }) {
  const query = useRpcQuery({
    contract: soulContract,
    method: "soulShow",
    input: { botId },
  });
  return (
    <SettingsGroup
      title="SOUL.md"
      description="Standing personality and instructions for this collaborator. Changes keep an attributable revision history."
    >
      {query.isLoading && <Skeleton className="h-40 w-full" />}
      {query.error && (
        <div role="alert">
          <p className="text-xs text-destructive">Could not read SOUL.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry SOUL read
          </Button>
        </div>
      )}
      {query.data && (
        <SoulEditor
          botId={botId}
          state={query.data}
          reread={() => void query.refetch()}
        />
      )}
    </SettingsGroup>
  );
}
