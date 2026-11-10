import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
export function WorktreesHeader({
  loading,
  refresh,
}: {
  loading: boolean;
  refresh: () => Promise<void>;
}) {
  return (
    <header className="flex items-center justify-between gap-3">
      <h1 className="text-sm font-medium">Worktrees</h1>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Refresh worktrees"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <Icon
              name="RotateCcw"
              className={loading ? "size-4 animate-spin" : "size-4"}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Refresh worktrees</TooltipContent>
      </Tooltip>
    </header>
  );
}
