import {
  AttentionView,
  attentionViewSchema,
  type Attention,
} from "./attention-view.tsx";
import { useState } from "react";
import { useActing } from "./acting-context.ts";
import { useLocalRead } from "./use-local-read.ts";
import { ReadStatus } from "./status.tsx";
import { Button } from "../ui/button.tsx";

function usePages() {
  const [discovery, setDiscovery] = useState([0]);
  const [required, setRequired] = useState([{ cursor: 0, targetId: "" }]);
  const [work, setWork] = useState([0]);
  const input = {
    limit: 10,
    after: discovery.at(-1)!,
    requiredAfter: required.at(-1)!,
    commitmentAfter: work.at(-1)!,
  };
  return {
    input,
    canBack: {
      discovery: discovery.length > 1,
      required: required.length > 1,
      commitments: work.length > 1,
    },
    next: (group: keyof Attention["pageCounts"], data: Attention) => {
      if (group === "discovery") {
        setDiscovery((old) => [...old, data.discovery.nextCursor]);
        return { ...input, after: data.discovery.nextCursor };
      }
      if (group === "required") {
        setRequired((old) => [...old, data.required.nextCursor]);
        return { ...input, requiredAfter: data.required.nextCursor };
      }
      setWork((old) => [...old, data.commitments.nextCursor]);
      return { ...input, commitmentAfter: data.commitments.nextCursor };
    },
    back: (group: keyof Attention["pageCounts"]) => {
      if (group === "discovery") {
        setDiscovery((old) => old.slice(0, -1));
        return { ...input, after: discovery.at(-2) ?? 0 };
      }
      if (group === "required") {
        setRequired((old) => old.slice(0, -1));
        return {
          ...input,
          requiredAfter: required.at(-2) ?? { cursor: 0, targetId: "" },
        };
      }
      setWork((old) => old.slice(0, -1));
      return { ...input, commitmentAfter: work.at(-2) ?? 0 };
    },
  };
}
export function AttentionPanel() {
  const acting = useActing();
  if (!acting.identity) return null;
  return acting.mode === "thread" ? (
    <ThreadAttention key={acting.threadId} />
  ) : (
    <OperatorAttention key={acting.identity.actorId} />
  );
}
function ThreadAttention() {
  const acting = useActing();
  const pages = usePages();
  const query = useLocalRead(
    acting.projectId,
    acting.threadId,
    { op: "check", input: pages.input },
    attentionViewSchema,
  );
  return (
    <section aria-label="Attention" className="space-y-3">
      <h2 className="font-medium">Attention</h2>
      <ReadStatus
        loading={query.isLoading}
        refreshing={query.isFetching && !query.isLoading}
        error={query.error}
        retry={query.refetch}
      />
      {query.data ? (
        <AttentionView
          data={query.data}
          pages={pages}
          pending={query.isFetching}
        />
      ) : null}
    </section>
  );
}
function OperatorAttention() {
  const acting = useActing();
  const pages = usePages();
  const [data, setData] = useState<{ input: string; page: Attention } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const input = JSON.stringify(pages.input);
  async function check(request = pages.input) {
    setError(null);
    const result = await acting.perform({ op: "check", input: request });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const parsed = attentionViewSchema.safeParse(result.data);
    if (parsed.success)
      setData({ input: JSON.stringify(request), page: parsed.data });
    else setError("Radio returned an unsupported attention view.");
  }
  return (
    <section aria-label="Attention" className="space-y-3">
      <h2 className="font-medium">Attention for @user</h2>
      <p className="text-xs text-muted-foreground">
        This is the last manual check. Check again after changes.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={acting.pending}
        onClick={() => void check()}
      >
        Check attention
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error} Any displayed page may be out of date.
        </p>
      ) : null}
      {data && data.input === input ? (
        <AttentionView
          data={data.page}
          pages={pages}
          pending={acting.pending}
          onPage={(request) => void check(request)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Check attention to load this page.
        </p>
      )}
    </section>
  );
}
