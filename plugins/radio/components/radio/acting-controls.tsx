import { useId, useState, type ReactNode } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { ThreadPicker } from "./thread-picker.tsx";
import type { ActingIdentity, ActingState } from "./acting-context.ts";

export function ActingControls({
  projectId,
  mode,
  threadId,
  identity,
  pending,
  operatorUnlocked,
  error,
  onMode,
  onThread,
  onLock,
  onUnlock,
  threadVerification,
}: {
  projectId: string;
  mode: ActingState["mode"];
  threadId: string;
  identity: ActingIdentity | null;
  pending: boolean;
  operatorUnlocked: boolean;
  error: string | null;
  onMode: (mode: ActingState["mode"]) => void;
  onThread: (id: string) => void;
  onLock: () => void;
  onUnlock: (credential: string) => void;
  threadVerification: ReactNode;
}) {
  const fieldId = useId();
  return (
    <section
      aria-label="Posting identity"
      className="space-y-3 border-y border-border py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={fieldId} className="text-sm font-medium">
          Act as
        </label>
        <Select
          value={mode}
          disabled={pending}
          onValueChange={(value) => onMode(value as ActingState["mode"])}
        >
          <SelectTrigger id={fieldId} className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="browse">Browse only</SelectItem>
            <SelectItem value="thread">A BB thread</SelectItem>
            <SelectItem value="operator">@user (operator)</SelectItem>
          </SelectContent>
        </Select>
        {mode === "operator" ? (
          <Button size="sm" variant="outline" onClick={onLock}>
            Lock operator
          </Button>
        ) : null}
      </div>
      {mode === "browse" ? (
        <p className="text-sm text-muted-foreground">
          Choose an identity to read its attention.
        </p>
      ) : null}
      {mode === "thread" ? (
        <>
          <ThreadPicker
            projectId={projectId}
            value={threadId}
            disabled={pending}
            onChange={onThread}
          />
          {threadVerification}
        </>
      ) : null}
      {mode === "operator" && !operatorUnlocked ? (
        <OperatorUnlock pending={pending} onUnlock={onUnlock} />
      ) : null}
      {mode === "operator" && operatorUnlocked ? (
        <p className="text-sm text-muted-foreground">
          Acting as @user. Operator access stays in this open panel. Lock when
          finished; closing this panel or switching project locks it.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {identity ? (
        <p className="text-sm break-words">
          Posting as{" "}
          {mode === "operator"
            ? "@user"
            : identity.handle
              ? `@${identity.project.name}:${identity.handle.name}`
              : "the selected BB thread"}
          . Posting here does not start an agent.
        </p>
      ) : null}
    </section>
  );
}
function OperatorUnlock({
  pending,
  onUnlock,
}: {
  pending: boolean;
  onUnlock: (credential: string) => void;
}) {
  const [entry, setEntry] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const credential = entry;
        setEntry("");
        onUnlock(credential);
      }}
    >
      <label className="block text-sm">
        Operator credential
        <Input
          type="password"
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
          minLength={16}
          maxLength={1024}
          required
          autoComplete="off"
          disabled={pending}
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Verifying…" : "Unlock @user"}
      </Button>
    </form>
  );
}
