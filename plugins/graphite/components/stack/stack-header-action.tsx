import * as Tooltip from "@radix-ui/react-tooltip";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";

import { StackPositionIcon } from "@/components/icons/stack-position.tsx";
import { useCurrentStack } from "./use-current-stack.ts";

export function StackHeaderAction({
  projectId,
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const { stack } = useCurrentStack(projectId, threadId);
  const navigate = useBbNavigate();

  if (stack === null || stack.outcome !== "stacked" || stack.total < 2)
    return null;

  const position = `${stack.position}/${stack.total}`;
  const state =
    stack.warnings.length > 0
      ? "Metadata changed"
      : stack.needsRestack
        ? "Needs restack"
        : stack.isStale
          ? "Drifted"
          : null;

  return (
    <Tooltip.Provider delayDuration={250}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={`Graphite stack ${position}${state ? `, ${state}` : ""}`}
            onClick={() =>
              navigate.openThreadPanel({
                actionId: "stack",
                title: "Graphite stack",
                params: { projectId },
              })
            }
            className={`flex h-7 cursor-pointer items-center justify-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground ${isCompactViewport ? "w-7" : "px-1.5"}`}
          >
            <StackPositionIcon
              position={stack.placement}
              className="size-4 shrink-0"
            />
            {isCompactViewport ? null : (
              <span className="tabular-nums">{position}</span>
            )}
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            sideOffset={4}
            className="z-50 max-w-[min(20rem,var(--radix-tooltip-content-available-width))] overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground break-words animate-in fade-in-0 zoom-in-95"
          >
            Graphite stack {position}
            {state ? (
              <span className="text-warning-text"> · {state}</span>
            ) : null}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
