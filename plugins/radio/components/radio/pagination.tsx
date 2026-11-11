import { Button } from "../ui/button.tsx";
export function Pagination({
  hasMore,
  canBack,
  next,
  back,
  refresh,
  pending,
}: {
  hasMore: boolean;
  canBack: boolean;
  next: () => void;
  back: () => void;
  refresh: () => unknown;
  pending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Button
        size="sm"
        variant="outline"
        disabled={!canBack || pending}
        onClick={back}
      >
        Previous page
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!hasMore || pending}
        onClick={next}
      >
        Next page
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => void refresh()}
      >
        Refresh
      </Button>
      {hasMore ? (
        <span className="text-xs text-muted-foreground">
          More results remain.
        </span>
      ) : null}
    </div>
  );
}
