import type { OverviewRow } from "../lib/overview.ts";
import { removalConsequences } from "../lib/overview.ts";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
export function WorktreeRemoval({
  row,
  open,
  onOpenChange,
  busy,
  error,
  retry,
  confirm,
}: {
  row: OverviewRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  error: string | null;
  retry: boolean;
  confirm: () => Promise<void>;
}) {
  const inspection = row.status === "present" ? row.inspection : null;
  const path = row.status === "present" ? row.inspection.path : row.path;
  const consequences =
    inspection === null ? null : removalConsequences(inspection);
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <AlertDialogContent className="max-h-[85dvh] w-[calc(100%_-_2rem)] overflow-y-auto rounded-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {retry ? "Retry removal?" : "Remove worktree?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            The branch is kept. Cleanup runs before a fresh safety inspection.
            If anything blocks removal, the folder is kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {path}
        </p>
        {consequences && (
          <div className="space-y-3 text-sm">
            {consequences.saved.length > 0 && (
              <div>
                <p className="mb-1 font-medium">Saved to a rescue ref</p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {consequences.saved.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </div>
            )}
            {consequences.blocked.length > 0 && (
              <div>
                <p className="mb-1 font-medium text-destructive">
                  Blocks removal
                </p>
                <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                  {consequences.blocked.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  No rescue or deletion takes place while a blocking condition
                  remains.
                </p>
              </div>
            )}
          </div>
        )}
        {inspection === null && (
          <p className="text-sm text-muted-foreground">
            The host will verify the record and ownership before touching the
            folder.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={buttonVariants({ variant: "destructive" })}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            {busy ? "Requesting…" : retry ? "Retry removal" : "Remove worktree"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
