import type { PluginThreadAction } from "@get-bb/plugin-sdk/app";
import type { CurrentStack } from "./current-stack.ts";

/** Let BB own the header button and compact menu placement. */
export function stackHeaderAction(
  stack: CurrentStack | null | undefined,
  open: () => void,
  refreshFailed = false,
): PluginThreadAction | null {
  if (stack?.outcome !== "stacked" || stack.total < 2) return null;
  const state = refreshFailed
    ? "Refresh failed"
    : stack.warnings.length > 0
      ? "Metadata changed"
      : stack.needsRestack
        ? "Needs restack"
        : stack.isStale
          ? "Drifted"
          : undefined;
  return {
    label: `Graphite ${stack.position}/${stack.total}${state ? ` · ${state}` : ""}`,
    icon: `graphite-stack-${stack.placement}`,
    run: open,
  };
}
