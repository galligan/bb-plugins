import { Button } from "../ui/button.tsx";
export function ReadStatus({
  loading,
  refreshing,
  error,
  retry,
}: {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  retry: () => unknown;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {loading ? (
        <span role="status">Loading Radio…</span>
      ) : refreshing ? (
        <span>Refreshing…</span>
      ) : null}
      {error ? (
        <>
          <p role="alert" className="text-destructive break-words">
            {error} Any displayed content may be out of date.
          </p>
          <Button variant="outline" size="sm" onClick={() => void retry()}>
            Retry read
          </Button>
        </>
      ) : null}
    </div>
  );
}
