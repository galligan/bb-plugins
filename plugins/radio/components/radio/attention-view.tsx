import { z } from "zod";
import type { AttentionRequest } from "../../lib/attention-contracts.ts";
import { useActing } from "./acting-context.ts";
import { RadioLink } from "./link.tsx";
import { Button } from "../ui/button.tsx";

const cursor = z.object({
  cursor: z.number().int().nonnegative(),
  targetId: z.string(),
});
const commitment = z.object({
  id: z.string(),
  cursor: z.number(),
  txId: z.string(),
  targetId: z.string(),
  ownerActorId: z.string(),
  openingSessionId: z.string().nullable(),
  generation: z.number(),
  status: z.enum(["open", "done", "abandoned"]),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  result: z.string().nullable(),
  reason: z.string().nullable(),
});
const page = <T extends z.ZodType, C extends z.ZodType>(
  item: T,
  nextCursor: C,
) => z.object({ items: z.array(item), hasMore: z.boolean(), nextCursor });
export const attentionViewSchema = z.object({
  discovery: page(
    z.object({
      id: z.string(),
      cursor: z.number(),
      body: z.string(),
      channelId: z.string(),
      authorId: z.string(),
      createdAt: z.string(),
    }),
    z.number(),
  ),
  required: page(
    z.object({
      txId: z.string(),
      cursor: z.number(),
      targetId: z.string(),
      needAck: z.boolean(),
      needReply: z.boolean(),
    }),
    cursor,
  ),
  commitments: page(commitment, z.number()),
  pageCounts: z.object({
    discovery: z.number(),
    required: z.number(),
    commitments: z.number(),
  }),
});
export type Attention = z.infer<typeof attentionViewSchema>;
interface AttentionPages {
  input: AttentionRequest;
  canBack: Record<keyof Attention["pageCounts"], boolean>;
  next: (
    group: keyof Attention["pageCounts"],
    data: Attention,
  ) => AttentionRequest;
  back: (group: keyof Attention["pageCounts"]) => AttentionRequest;
}
export function AttentionView({
  data,
  pages,
  pending,
  onPage,
}: {
  data: Attention;
  pages: AttentionPages;
  pending: boolean;
  onPage?: (request: AttentionRequest) => void;
}) {
  const acting = useActing();
  const controls = (group: keyof Attention["pageCounts"]) => (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending || !pages.canBack[group]}
        onClick={() => {
          const request = pages.back(group);
          onPage?.(request);
        }}
      >
        Previous {group}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || !data[group].hasMore}
        onClick={() => {
          const request = pages.next(group, data);
          onPage?.(request);
        }}
      >
        Next {group}
      </Button>
      <span className="text-xs text-muted-foreground">
        {data.pageCounts[group]} on this page
        {data[group].hasMore ? " · More remain" : ""}.
      </span>
    </div>
  );
  return (
    <div className="space-y-4">
      <section aria-label="Discovered transmissions">
        <h3 className="text-sm font-medium">Discovered transmissions</h3>
        {!data.discovery.items.length ? (
          <p className="text-sm text-muted-foreground">None on this page.</p>
        ) : (
          <ul className="space-y-2">
            {data.discovery.items.map((item) => (
              <li key={item.id}>
                <RadioLink
                  route={{
                    projectId: acting.projectId,
                    kind: "transmission",
                    id: item.id,
                  }}
                >
                  {item.body}
                </RadioLink>
              </li>
            ))}
          </ul>
        )}
        {controls("discovery")}
      </section>
      <section aria-label="Required responses">
        <h3 className="text-sm font-medium">Required responses</h3>
        {!data.required.items.length ? (
          <p className="text-sm text-muted-foreground">None on this page.</p>
        ) : (
          <ul className="space-y-2">
            {data.required.items.map((item) => (
              <li key={`${item.txId}:${item.targetId}`}>
                <RadioLink
                  route={{
                    projectId: acting.projectId,
                    kind: "transmission",
                    id: item.txId,
                  }}
                >
                  Open request
                </RadioLink>
                <p className="text-xs text-muted-foreground break-words">
                  {item.targetId === acting.identity!.actorId
                    ? acting.mode === "operator"
                      ? "@user recipient"
                      : "Actor recipient"
                    : item.targetId === acting.identity!.sessionId
                      ? "Acting session"
                      : "Another owned session"}
                  : <code className="break-all">{item.targetId}</code> ·{" "}
                  {item.needAck ? "Ack needed" : ""}
                  {item.needAck && item.needReply ? "; " : ""}
                  {item.needReply ? "Reply needed" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        {controls("required")}
      </section>
      <section aria-label="Open commitments">
        <h3 className="text-sm font-medium">Open commitments</h3>
        {!data.commitments.items.length ? (
          <p className="text-sm text-muted-foreground">None on this page.</p>
        ) : (
          <ul className="space-y-2">
            {data.commitments.items.map((item) => (
              <li key={item.id}>
                <RadioLink
                  route={{
                    projectId: acting.projectId,
                    kind: "transmission",
                    id: item.txId,
                  }}
                >
                  Open committed request
                </RadioLink>
                <p className="text-xs text-muted-foreground break-all">
                  {item.targetId} · generation {item.generation}
                </p>
              </li>
            ))}
          </ul>
        )}
        {controls("commitments")}
      </section>
      <p className="text-xs text-muted-foreground">
        Reading attention is not receipt, ack or accepting work. Required
        responses and commitments are independent of discovery recency and mute.
      </p>
    </div>
  );
}
