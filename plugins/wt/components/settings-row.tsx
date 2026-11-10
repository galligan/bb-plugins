import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** Matches bb's built-in settings group and label/control alignment. */
export function SettingsGroup({ children }: { children: ReactNode }) {
  return (
    <Card className="@container/settings space-y-4 overflow-hidden rounded-md bg-surface-recessed/70 p-3">
      {children}
    </Card>
  );
}
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5 has-[[role=switch]]:flex-row has-[[role=switch]]:justify-between has-[[role=switch]]:gap-5 @min-[36rem]/settings:flex-row @min-[36rem]/settings:justify-between @min-[36rem]/settings:gap-5">
      <div className="min-w-0 flex-1">
        <label
          htmlFor={htmlFor}
          className="text-sm font-normal text-foreground"
        >
          {label}
        </label>
        {description && (
          <div className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
            {description}
          </div>
        )}
      </div>
      <div className="min-w-0 shrink-0 @min-[36rem]/settings:max-w-[55%]">
        {children}
      </div>
    </div>
  );
}
