import { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
export function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`${COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS} shrink-0 text-muted-foreground`}
          aria-label={label}
          onClick={async () => {
            if (await experimental_copyToClipboard({ text }))
              toast.success("Copied to clipboard");
            else toast.error("Could not copy to clipboard");
          }}
        >
          <Icon name="Copy" className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
