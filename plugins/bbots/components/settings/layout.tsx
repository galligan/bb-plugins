import type { ReactNode } from "react";
import { cn } from "../../lib/utils.ts";

export const SETTINGS_CONTROL_CLASS =
  "h-7 text-xs max-md:pointer-coarse:h-9 max-md:pointer-coarse:text-base";

// The registry has controls, while settings sections are host composition.
// Match the host's SettingsSection/SettingsWithControl spacing and tokens.
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="@container/settings space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-4 rounded-lg border border-border bg-card px-4 py-3.5">
        {children}
      </div>
    </section>
  );
}
export function SettingRow({
  label,
  htmlFor,
  description,
  children,
}: {
  label: string;
  htmlFor: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2.5 @min-[36rem]/settings:flex-row @min-[36rem]/settings:justify-between @min-[36rem]/settings:gap-5",
        description
          ? "@min-[36rem]/settings:items-start"
          : "@min-[36rem]/settings:items-center",
      )}
    >
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-sm text-foreground">
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">
            {description}
          </p>
        )}
      </div>
      <div className="w-full min-w-0 @min-[36rem]/settings:w-64">
        {children}
      </div>
    </div>
  );
}
