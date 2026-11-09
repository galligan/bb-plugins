// The "Rex" tab: one terminal pane and a line of status above it.

import { useState, type ReactNode } from "react";

import { TerminalView } from "./terminal-view.tsx";
import { usePane, type PaneState } from "./use-pane.ts";

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function ActionButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-md border border-input px-2 py-0.5 text-xs text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

function statusText(pane: Extract<PaneState, { phase: "open" }>): string {
  if (pane.exit !== null) {
    return pane.exit.code === null
      ? "program exited"
      : `program exited with code ${pane.exit.code}`;
  }
  if (!pane.live) return "stream ended";
  if (pane.frame === null) return "waiting for the terminal";
  return `${pane.frame.cols}×${pane.frame.rows}`;
}

export function RexTab() {
  const [attempt, setAttempt] = useState(0);
  const pane = usePane(attempt);
  const reopen = () => setAttempt((count) => count + 1);

  if (pane.phase === "connecting") {
    return <Notice>Connecting to Rex…</Notice>;
  }
  if (pane.phase === "failed") {
    return (
      <Notice>
        <p className="max-w-prose text-foreground">{pane.message}</p>
        <ActionButton onClick={reopen}>Try again</ActionButton>
      </Notice>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{pane.sessionLabel}</span>
        <span className="shrink-0">{statusText(pane)}</span>
        <span className="min-w-0 flex-1 truncate text-destructive">
          {pane.inputProblem}
        </span>
        {!pane.live && <ActionButton onClick={reopen}>Reconnect</ActionButton>}
      </div>
      {pane.frame !== null && (
        <TerminalView
          frame={pane.frame}
          onInput={pane.live ? pane.send : null}
          claimsPane={pane.claimsPane}
        />
      )}
    </div>
  );
}
