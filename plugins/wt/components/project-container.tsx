import { useEffect, useState, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Icon } from "@/components/ui/icon";

export function ProjectContainer({
  projectKey,
  title,
  count,
  attention = 0,
  noun = "worktrees",
  children,
}: {
  projectKey: string;
  title: string;
  count: number;
  attention?: number;
  noun?: string;
  children: ReactNode;
}) {
  const storageKey = `wt:collapsed:${projectKey}`;
  const [open, setOpen] = useState(() => {
    if (attention > 0) return true;
    try {
      return localStorage.getItem(storageKey) !== "true";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (attention > 0) setOpen(true);
  }, [attention]);
  return (
    <Collapsible
      data-wt-project={projectKey}
      data-attention={attention}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        try {
          localStorage.setItem(storageKey, String(!next));
        } catch {
          /* Browser storage is optional. */
        }
      }}
      className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
    >
      <CollapsibleTrigger className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
        <span className="min-w-0 truncate text-sm font-medium leading-5">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs leading-5 text-muted-foreground">
          <span>
            {count}{" "}
            {count === 1 ? (noun === "worktrees" ? "worktree" : "ref") : noun}
          </span>
          {attention > 0 && (
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${attention} need attention`}
            >
              <Icon name="AlertTriangle" className="size-3.5" />
              {attention}
            </span>
          )}
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            className="size-3.5"
          />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-4 py-1">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
