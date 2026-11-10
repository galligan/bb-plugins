import { Icon } from "@/components/ui/icon";
export function Loading({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-2 py-3 text-xs text-muted-foreground"
    >
      <Icon name="Loading" className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
