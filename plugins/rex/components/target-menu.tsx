// The control in the Rex tab that says which Rex session and window the
// thread shows, and lets the person pick another: any window of any session
// on the Rex server, a particular pane of the window shown, or the thread's
// own window again.
//
// It is bb's dropdown menu, vendored from the registry, so it opens as a
// sheet on a compact screen and behaves as bb's other menus do. The windows
// are read when the menu opens, so the list is as Rex has it then.

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS } from "@/components/ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";

import { paneErrorBodySchema } from "../lib/pane-error.ts";
import { targetsSchema, type Targets } from "../lib/targets.ts";
import type { ThreadView } from "../lib/thread-view.ts";

const HTTP_BASE = "/api/v1/plugins/rex/http";

type Loaded =
  | { phase: "loading" }
  | { phase: "failed"; message: string }
  | { phase: "ready"; targets: Targets };

async function failureMessage(response: Response): Promise<string> {
  const body = paneErrorBodySchema.safeParse(
    await response.json().catch(() => null),
  );
  return body.success
    ? body.data.error.message
    : `The request failed with HTTP ${response.status}.`;
}

async function loadTargets(threadId: string): Promise<Targets> {
  const response = await fetch(
    `${HTTP_BASE}/targets?thread=${encodeURIComponent(threadId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(await failureMessage(response));
  return targetsSchema.parse(await response.json());
}

async function setTarget(
  threadId: string,
  target: ThreadView | null,
): Promise<void> {
  const response = await fetch(`${HTTP_BASE}/target`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ thread: threadId, target }),
  });
  if (!response.ok) throw new Error(await failureMessage(response));
}

/** The end of an ID, as Rex shows it, to tell apart panes with one label. */
const shortId = (id: string) => id.slice(-6);

function Choices({
  targets,
  onChoose,
}: {
  targets: Targets;
  onChoose: (target: ThreadView | null) => void;
}) {
  const { sessions, own, pick } = targets;
  const isOwn = (sessionId: string, windowId: string) =>
    own !== null && own.sessionId === sessionId && own.windowId === windowId;
  const showsOwn = pick === null || isOwn(pick.sessionId, pick.windowId);
  // The window shown now, which is the one whose panes can be chosen between.
  const shown = showsOwn ? own : pick;
  const shownWindow =
    shown === null
      ? undefined
      : sessions
          .find((session) => session.sessionId === shown.sessionId)
          ?.windows.find((window) => window.windowId === shown.windowId);
  const others = sessions
    .map((session) => ({
      ...session,
      windows: session.windows.filter(
        (window) => !isOwn(session.sessionId, window.windowId),
      ),
    }))
    .filter((session) => session.windows.length > 0);

  return (
    <>
      <DropdownMenuCheckboxItem
        checked={showsOwn}
        onSelect={() => onChoose(null)}
      >
        This thread's window
      </DropdownMenuCheckboxItem>
      {shown !== null &&
        shownWindow !== undefined &&
        shownWindow.panes.length > 1 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Pane of the window shown</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={pick === null || pick.blockId === null}
              onSelect={() => onChoose({ ...shown, blockId: null })}
            >
              Whichever has focus
            </DropdownMenuCheckboxItem>
            {shownWindow.panes.map((pane) => (
              <DropdownMenuCheckboxItem
                key={pane.blockId}
                checked={pick?.blockId === pane.blockId}
                onSelect={() => onChoose({ ...shown, blockId: pane.blockId })}
              >
                <span className="min-w-0 truncate">{pane.label}</span>
                <span className="ml-auto pl-2 font-mono text-muted-foreground">
                  {shortId(pane.blockId)}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      <DropdownMenuSeparator />
      {others.length === 0 && (
        <DropdownMenuLabel>No other windows in Rex</DropdownMenuLabel>
      )}
      {others.map((session) => (
        <div key={session.sessionId} role="group" aria-label={session.label}>
          <DropdownMenuLabel className="truncate">
            Session: {session.label}
          </DropdownMenuLabel>
          {session.windows.map((window) => (
            <DropdownMenuCheckboxItem
              key={window.windowId}
              checked={
                pick !== null &&
                pick.sessionId === session.sessionId &&
                pick.windowId === window.windowId
              }
              onSelect={() =>
                onChoose({
                  sessionId: session.sessionId,
                  windowId: window.windowId,
                  blockId: null,
                })
              }
            >
              <span className="min-w-0 truncate">{window.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </div>
      ))}
    </>
  );
}

export function TargetMenu({
  threadId,
  shown,
  onChanged,
}: {
  threadId: string;
  /** The session and window the tab shows now, if it shows one. */
  shown: { sessionLabel: string; windowLabel: string } | null;
  /** Called once a pick has been stored, to open what was picked. */
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ phase: "loading" });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoaded({ phase: "loading" });
    loadTargets(threadId).then(
      (targets) => setLoaded({ phase: "ready", targets }),
      (error: unknown) =>
        setLoaded({
          phase: "failed",
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  };
  const choose = (target: ThreadView | null) => {
    setSaving(true);
    setTarget(threadId, target)
      .then(onChanged, (error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setSaving(false));
  };

  const name =
    shown === null
      ? "Rex window"
      : `${shown.sessionLabel} › ${shown.windowLabel}`;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={saving}
          aria-label={`${name}. Choose the Rex window this thread shows`}
          className={`${COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS} h-6 min-w-0 shrink gap-1 px-1.5 font-medium text-foreground`}
        >
          <span className="min-w-0 truncate">{name}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        mobileTitle="Rex window"
        className="max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] w-72 overflow-y-auto"
      >
        {loaded.phase === "loading" && (
          <DropdownMenuLabel>Reading Rex's windows…</DropdownMenuLabel>
        )}
        {loaded.phase === "failed" && (
          <>
            <DropdownMenuLabel className="whitespace-normal text-destructive">
              {loaded.message}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={(event) => {
                // Stay open to show the list.
                event.preventDefault();
                load();
              }}
            >
              Try again
            </DropdownMenuItem>
          </>
        )}
        {loaded.phase === "ready" && (
          <Choices targets={loaded.targets} onChoose={choose} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
