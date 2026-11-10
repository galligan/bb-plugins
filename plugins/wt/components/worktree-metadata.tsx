import type { ReactNode } from "react";
import {
  useBbNavigate,
  experimental_ThreadTitleText as ThreadTitleText,
} from "@get-bb/plugin-sdk/app";
import type { OverviewRow } from "../lib/overview.ts";
import { age } from "../lib/render.ts";
import { branchDescription } from "../lib/display.ts";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

function Meta({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <span className="inline-flex h-4 min-w-0 items-center gap-1.5 leading-4">
      <Icon name={icon} className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
const Dot = () => (
  <span aria-hidden="true" className="shrink-0">
    ·
  </span>
);
export function WorktreeMetadata({ row }: { row: OverviewRow }) {
  const navigate = useBbNavigate();
  const first = row.threads[0];
  return (
    <div
      data-wt-metadata
      className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs leading-4 text-muted-foreground"
    >
      {row.status === "present" && (
        <>
          <Meta icon="GitBranch">{branchDescription(row.inspection)}</Meta>
          <Dot />
          <Meta icon="Clock">
            {age(row.inspection.lastActivity, Date.now())}
          </Meta>
        </>
      )}
      {first && (
        <>
          {row.status === "present" && <Dot />}
          <button
            className="inline-flex h-4 min-w-0 items-center gap-1.5 rounded-sm text-left hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => navigate.toThread(first.id)}
            aria-label={`Open thread: ${first.title}`}
          >
            <Icon name="MessageSquare" className="size-3.5 shrink-0" />
            <span className="truncate">
              <ThreadTitleText title={first.title} />
            </span>
          </button>
          {row.threads.length > 1 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-5 shrink-0 px-1 text-xs max-md:pointer-coarse:h-9"
                  aria-label={`${row.threads.length - 1} more threads`}
                >
                  +{row.threads.length - 1}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-72 max-w-[calc(100vw-2rem)] p-1"
                align="end"
              >
                <ul>
                  {row.threads.slice(1).map((thread) => (
                    <li key={thread.id}>
                      <Button
                        variant="ghost"
                        className="h-auto min-h-8 w-full justify-start whitespace-normal px-2 py-1 text-left text-xs"
                        onClick={() => navigate.toThread(thread.id)}
                      >
                        <span className="min-w-0 break-words">
                          <ThreadTitleText title={thread.title} />
                          {thread.archived && (
                            <span className="ml-1 text-muted-foreground">
                              (archived)
                            </span>
                          )}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
        </>
      )}
    </div>
  );
}
