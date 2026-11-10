import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsGroup, SettingsRow } from "./settings-row.tsx";
import { CopyButton } from "./copy-button.tsx";
type BranchDraft = {
  custom: boolean;
  prefixBranches: boolean;
  branchPrefix: string;
};
export function BranchSettings({
  current,
  onChange,
  busy,
  validPrefix,
  preview,
}: {
  current: BranchDraft;
  onChange: (next: BranchDraft) => void;
  busy: boolean;
  validPrefix: boolean;
  preview: string;
}) {
  return (
    <SettingsGroup>
      <SettingsRow
        label="Branch naming"
        htmlFor="wt-branch-mode"
        description="Use the global settings or customize naming for this project."
      >
        <Select
          disabled={busy}
          value={current.custom ? "custom" : "global"}
          onValueChange={(value) =>
            onChange({ ...current, custom: value === "custom" })
          }
        >
          <SelectTrigger
            id="wt-branch-mode"
            className="h-7 w-full text-xs @min-[36rem]/settings:w-64"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">Use global setting</SelectItem>
            <SelectItem value="custom">Custom for this project</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      {current.custom && (
        <>
          <SettingsRow
            label="Prefix worktree branches"
            htmlFor="wt-prefix-enabled"
            description="Start the suggested branch name with a prefix."
          >
            <Switch
              id="wt-prefix-enabled"
              disabled={busy}
              checked={current.prefixBranches}
              onCheckedChange={(prefixBranches) =>
                onChange({ ...current, prefixBranches })
              }
            />
          </SettingsRow>
          <SettingsRow
            label="Branch prefix"
            htmlFor="wt-project-prefix"
            description="Leave empty to use bb’s branch prefix."
          >
            <Input
              id="wt-project-prefix"
              disabled={busy}
              value={current.branchPrefix}
              className="h-7 w-full font-mono text-xs @min-[36rem]/settings:w-64"
              onChange={(event) =>
                onChange({ ...current, branchPrefix: event.target.value })
              }
              aria-invalid={!validPrefix}
            />
          </SettingsRow>
          {!validPrefix && (
            <p role="alert" className="text-xs text-destructive">
              Not a valid start for a git branch name
            </p>
          )}
        </>
      )}
      <SettingsRow label="Preview" description="Example for “Fix login bug”.">
        <div className="flex items-center gap-1">
          <code className="break-all text-xs text-muted-foreground">
            {preview}
          </code>
          <CopyButton text={preview} label="Copy branch preview" />
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}
