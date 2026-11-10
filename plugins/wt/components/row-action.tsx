import { forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const RowAction = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    icon: string;
    onClick: () => void;
    disabled?: boolean;
    destructive?: boolean;
  }
>(function RowAction({ label, icon, onClick, disabled, destructive }, ref) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={`${COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS} text-muted-foreground ${destructive ? "hover:text-destructive" : ""}`}
        >
          <Icon name={icon} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});
