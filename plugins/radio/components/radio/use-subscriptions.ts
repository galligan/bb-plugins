import { useRef, useState } from "react";
import { experimental_useTabVisible } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { useActing } from "./acting-context.ts";
import { pageSchema } from "./view-schemas.ts";

const subscriptionSchema = z.object({
  cursor: z.number().int().nonnegative(),
  targetId: z.string(),
  channelId: z.string(),
  muted: z.boolean(),
});
const listingSchema = pageSchema(subscriptionSchema, z.number());
type Page = z.infer<typeof listingSchema>;
const changeSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.enum(["listening", "muted"]),
    subscription: subscriptionSchema,
  }),
  z.object({
    state: z.literal("unlistening"),
    targetId: z.string(),
    channelId: z.string(),
  }),
]);

/** These state-setting operations have no replay key. Reads and new writes are explicit. */
export function useSubscriptions(channelId: string, targetId: string) {
  const acting = useActing();
  const visible = experimental_useTabVisible();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [cursors, setCursors] = useState([0]);
  const [page, setPage] = useState<{ after: number; data: Page } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [inspected, setInspected] = useState(false);
  const [observation, setObservation] = useState<string | null>(null);
  const blocked = !visible || pending || acting.pending;
  async function read(after = cursors.at(-1)!, nextCursors = cursors) {
    if (!visible || busy.current || acting.pending) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setInspected(false);
    try {
      const result = await acting.perform({
        op: "listening",
        input: { targetId, after, limit: 20 },
      });
      const parsed = result.ok ? listingSchema.safeParse(result.data) : null;
      if (
        !parsed?.success ||
        parsed.data.items.some((item) => item.targetId !== targetId)
      ) {
        setError(
          result.ok
            ? "Radio returned an unsupported subscription page."
            : result.error.message,
        );
        return;
      }
      setCursors(nextCursors);
      setPage({ after, data: parsed.data });
      if (uncertain) {
        const current = await acting.perform({
          op: "listening",
          input: { targetId, channelId, after: 0, limit: 1 },
        });
        if (!current.ok) throw new Error("Affected channel lookup failed");
        const exact = listingSchema.parse(current.data);
        if (
          exact.hasMore ||
          exact.items.length > 1 ||
          exact.items.some(
            (item) =>
              item.targetId !== targetId || item.channelId !== channelId,
          )
        )
          throw new Error("Affected subscription scope changed");
        setObservation(
          exact.items[0]
            ? exact.items[0].muted
              ? "Muted at last exact check."
              : "Listening at last exact check."
            : "Unsubscribed at last exact check.",
        );
        setInspected(true);
      }
    } catch {
      setError("Subscriptions could not be checked. Check again explicitly.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  async function change(kind: "listen" | "mute" | "unlisten") {
    if (!visible || busy.current || acting.pending || uncertain) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setConfirmation(null);
    setInspected(false);
    setObservation(null);
    try {
      const result = await acting.perform({
        op: "subscribe",
        input: { channelId, targetId, kind },
      });
      const parsed = result.ok ? changeSchema.safeParse(result.data) : null;
      const value = parsed?.success ? parsed.data : null;
      const binding =
        value && (value.state === "unlistening" ? value : value.subscription);
      const expected =
        kind === "listen"
          ? "listening"
          : kind === "mute"
            ? "muted"
            : "unlistening";
      if (
        !value ||
        !binding ||
        value.state !== expected ||
        binding.targetId !== targetId ||
        binding.channelId !== channelId ||
        (value.state !== "unlistening" &&
          value.subscription.muted !== (kind === "mute"))
      ) {
        setUncertain(true);
        setError(
          `${result.ok ? "Unsupported subscription result." : result.error.message} The change is unconfirmed. Inspect current subscriptions before making a new change.`,
        );
        return;
      }
      // Confirmation is an operation result; another panel may have changed it since.
      setConfirmation(
        kind === "listen"
          ? "Listen recorded."
          : kind === "mute"
            ? "Mute recorded."
            : "Unlisten recorded.",
      );
    } catch {
      setUncertain(true);
      setError(
        "The change is unconfirmed. Inspect current subscriptions before making a new change.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    page: page && page.after === cursors.at(-1) ? page.data : null,
    error,
    confirmation,
    uncertain,
    inspected,
    observation,
    blocked,
    read: () => read(),
    next: () =>
      page && read(page.data.nextCursor, [...cursors, page.data.nextCursor]),
    back: () => read(cursors.at(-2) ?? 0, cursors.slice(0, -1)),
    canBack: cursors.length > 1,
    change,
    allowNewChange: () => {
      if (blocked || !inspected) return;
      setUncertain(false);
      setObservation(null);
      setError(null);
      setInspected(false);
    },
  };
}
