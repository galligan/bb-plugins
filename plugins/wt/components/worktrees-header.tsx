import { useSyncExternalStore } from "react";
import { COARSE_POINTER_HEADER_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  isRefreshing,
  refreshWorktrees,
  subscribeRefresh,
} from "./worktrees-refresh.ts";
export function WorktreesHeader() {
  const loading = useSyncExternalStore(subscribeRefresh, isRefreshing);
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={COARSE_POINTER_HEADER_ICON_BUTTON_CLASS}
            aria-label="Refresh worktrees"
            disabled={loading}
            onClick={() => void refreshWorktrees()}
          >
            <Icon
              name="RotateCcw"
              className={loading ? "size-4 animate-spin" : "size-4"}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh worktrees</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
