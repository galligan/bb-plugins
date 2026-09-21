// One branch on the spine, with the branches hanging off it shown on request.

import { Icon } from "@/components/ui/icon";
import { ChainJoin, LineageNode, OffshootLanes, layoutOffshoots } from "./lineage.tsx";
import { RestackMark } from "./restack-mark.tsx";
import { ThreadMarks } from "./thread-mark.tsx";
import type { CurrentStackBranch } from "@/lib/current-stack.ts";
import { cn } from "@/lib/utils";

/** One branch on the spine, plus its offshoots when they are shown. */
export function StackRow({
  branch,
  first,
  last,
  open,
  onToggle,
  laneWidth: lanes,
}: {
  readonly branch: CurrentStackBranch;
  readonly first: boolean;
  readonly last: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly laneWidth: number;
}) {
  const count = branch.offshoots.length;
  const showOffshoots = open && count > 0;

  return (
    <li>
      {/* Offshoots sit above the branch they hang off, the way `gt ls` stacks them,
          so the parent's row is where the columns join. */}
      {showOffshoots
        ? layoutOffshoots(branch.offshoots).map((row) => (
            <div
              key={row.offshoot.name}
              className="grid grid-cols-[0.875rem_auto_minmax(0,1fr)] items-center gap-x-1.5 rounded px-2"
            >
              <LineageNode first={first} last={last} current={false} passthrough />
              <OffshootLanes row={row} width={lanes} />
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs leading-5 opacity-55">
                  {row.offshoot.name}
                </span>
                {row.offshoot.needsRestack ? <RestackMark /> : null}
                <ThreadMarks threads={row.offshoot.threads} />
              </span>
            </div>
          ))
        : null}
      <div className="grid grid-cols-[0.875rem_auto_minmax(0,1fr)] items-center gap-x-1.5 rounded px-2">
        <LineageNode
          first={first}
          last={last}
          current={branch.isCurrent}
          join={showOffshoots}
        />
        {showOffshoots ? (
          <ChainJoin
            columns={branch.offshoots
              .filter((offshoot) => offshoot.parent === null)
              .map((offshoot) => offshoot.column)}
            width={lanes}
          />
        ) : (
          <span style={{ width: lanes }} className="shrink-0" />
        )}
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "truncate text-xs leading-5",
              branch.isCurrent ? "font-medium text-foreground" : "opacity-70",
            )}
          >
            {branch.name}
          </span>
          {branch.needsRestack ? <RestackMark /> : null}
          <ThreadMarks threads={branch.threads} />
          {count > 0 ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={`${count} branch${count === 1 ? "" : "es"} off ${branch.name}`}
              className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 text-2xs leading-4 text-subtle-foreground transition-colors hover:bg-state-hover hover:text-foreground"
            >
              <Icon
                name="ChevronRight"
                className={cn("size-3 transition-transform duration-150", open && "rotate-90")}
              />
              {count}
            </button>
          ) : null}
        </span>
      </div>
    </li>
  );
}
