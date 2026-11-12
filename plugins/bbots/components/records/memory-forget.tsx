import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { experimental_useRpcMutation as useRpcMutation } from "@get-bb/plugin-sdk/app";
import { memoryForgetContract } from "../../lib/ui/memory-forget.ts";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";

export function MemoryForget({
  threadId,
  botId,
  id,
  revision,
  suppressed,
  active,
  readable,
  read,
  confirmed,
}: {
  threadId: string;
  botId: string;
  id: string;
  revision: number | null;
  suppressed: boolean;
  active: boolean;
  readable: boolean;
  read(): Promise<void>;
  confirmed(returnFocus: boolean): void;
}) {
  const labelId = useId();
  const [base, setBase] = useState<number | null>(null);
  const [needsRead, setNeedsRead] = useState(false);
  const busy = useRef(false),
    alive = useRef(true),
    foreground = useRef(active);
  const form = useRef<HTMLFormElement>(null);
  const mutation = useRpcMutation({
    contract: memoryForgetContract,
    method: "botMemoryForget",
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    foreground.current = active;
  }, [active]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !active ||
      !readable ||
      suppressed ||
      needsRead ||
      busy.current ||
      base === null ||
      base !== revision
    )
      return;
    const hadFocus = form.current?.contains(document.activeElement);
    busy.current = true;
    try {
      const result = await mutation.mutate({
        threadId,
        expectedBotId: botId,
        id,
        expectedRevision: base,
        confirm: true,
      });
      if (
        result.botId !== botId ||
        result.threadId !== threadId ||
        result.id !== id
      )
        throw new Error("Forget response differs from the selected memory");
      if (alive.current && foreground.current) {
        const returnFocus =
          form.current?.contains(document.activeElement) ||
          (hadFocus && document.activeElement === document.body);
        confirmed(Boolean(returnFocus));
      }
    } catch {
      if (alive.current) setNeedsRead(true);
    } finally {
      busy.current = false;
    }
  }
  async function reread() {
    if (!active || busy.current) return;
    setBase(null);
    await read();
    if (alive.current) {
      setNeedsRead(false);
      mutation.reset();
    }
  }
  if (suppressed || (revision === null && !needsRead && !mutation.isPending))
    return null;
  return (
    <form
      ref={form}
      onSubmit={(event) => void submit(event)}
      className="space-y-3 border-t border-border pt-3"
    >
      <h3 className="text-sm font-medium">Forget memory</h3>
      <p className="text-xs text-muted-foreground">
        Excludes this record, known sources and derived memories from new
        retrieval. Historical revisions, previous exports and live context can
        retain it. This does not purge history or refresh a session, and
        independently restated facts may not be recognized.
      </p>
      <div className="flex items-start gap-2">
        <Checkbox
          id={labelId}
          checked={base !== null}
          disabled={
            !active ||
            !readable ||
            needsRead ||
            mutation.isPending ||
            revision === null
          }
          onCheckedChange={(checked) =>
            setBase(checked === true ? revision : null)
          }
        />
        <label htmlFor={labelId} className="text-xs leading-5">
          Exclude this memory and its known sources from new retrieval
        </label>
      </div>
      {base !== null && revision !== base && (
        <p role="status" className="text-xs text-muted-foreground">
          Memory changed since confirmation. Clear the confirmation and review
          the current version.
        </p>
      )}
      {needsRead && (
        <p role="alert" className="text-xs text-destructive">
          Could not confirm forgetting. Read the current memory before making
          another decision; no automatic retry is sent.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {needsRead && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!active || mutation.isPending}
            onClick={() => void reread()}
          >
            Read current memory
          </Button>
        )}
        <Button
          type="submit"
          variant="destructive"
          size="sm"
          disabled={
            !active ||
            !readable ||
            needsRead ||
            mutation.isPending ||
            base === null ||
            base !== revision
          }
        >
          {mutation.isPending ? "Forgetting…" : "Forget memory"}
        </Button>
      </div>
    </form>
  );
}
