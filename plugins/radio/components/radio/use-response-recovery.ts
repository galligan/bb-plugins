import { useRef, useState } from "react";
import { experimental_useTabVisible } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { responseSchema } from "../../lib/protocol-contracts.ts";
import { useActing, type ActingIdentity } from "./acting-context.ts";
import { responseEventSchema } from "./response-views.ts";

const savedSchema = z
  .object({
    version: z.literal(1),
    request: responseSchema,
    event: responseEventSchema.nullable(),
  })
  .strict();
type SavedResponse = z.infer<typeof savedSchema>;
export interface ResponseScope {
  identity: ActingIdentity;
  projectId: string;
  txId: string;
}
export function responseRecoveryKey({
  identity,
  projectId,
  txId,
}: ResponseScope) {
  return `radio-response-v1:${JSON.stringify([identity.stationId, projectId, identity.actorId, identity.sessionId, txId])}`;
}
function decode(scope: ResponseScope, raw: string | null) {
  if (!raw) return null;
  if (raw.length > 20000) throw new Error("Saved response exceeds its bound.");
  const saved = savedSchema.parse(JSON.parse(raw));
  if (saved.request.txId !== scope.txId)
    throw new Error("Saved response destination changed.");
  return saved;
}
function read(scope: ResponseScope) {
  return decode(scope, sessionStorage.getItem(responseRecoveryKey(scope)));
}
function write(scope: ResponseScope, value: SavedResponse | null) {
  const key = responseRecoveryKey(scope);
  if (value)
    sessionStorage.setItem(key, JSON.stringify(savedSchema.parse(value)));
  else sessionStorage.removeItem(key);
}
export function useResponseRecovery(scope: ResponseScope) {
  const acting = useActing();
  const visible = experimental_useTabVisible();
  const unreadableRaw = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<{
    saved: SavedResponse | null;
    error: string | null;
    unreadable: boolean;
  }>(() => {
    let raw: string | null | undefined;
    try {
      raw = sessionStorage.getItem(responseRecoveryKey(scope));
      return { saved: decode(scope, raw), error: null, unreadable: false };
    } catch {
      unreadableRaw.current = raw;
      return {
        saved: null,
        error:
          "Saved response could not be read. Inspect response history before clearing its recovery record.",
        unreadable: true,
      };
    }
  });
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  async function send(request: z.input<typeof responseSchema>, replay = false) {
    if (
      !visible ||
      busy.current ||
      acting.pending ||
      state.unreadable ||
      (state.saved && !state.saved.event && !replay)
    )
      return;
    let next: SavedResponse;
    try {
      next = {
        version: 1,
        request: responseSchema.parse(request),
        event: null,
      };
      const current = read(scope);
      if (
        current &&
        !current.event &&
        current.request.idempotencyKey !==
          (replay ? state.saved?.request.idempotencyKey : undefined)
      ) {
        setState({
          saved: current,
          error:
            "Another panel saved a pending response. Retry that original response or inspect history before clearing it.",
          unreadable: false,
        });
        return;
      }
      write(scope, next);
    } catch {
      setState((old) => ({
        ...old,
        error:
          "Recovery storage is unavailable; no new response was attempted.",
      }));
      return;
    }
    busy.current = true;
    setSending(true);
    setState({ saved: next, error: null, unreadable: false });
    try {
      const result = await acting.perform({
        op: "respond",
        input: next.request,
      });
      const parsed = result.ok
        ? z
            .object({ replayed: z.boolean(), event: responseEventSchema })
            .safeParse(result.data)
        : null;
      const event = parsed?.success ? parsed.data.event : null;
      if (
        !event ||
        event.stationId !== scope.identity.stationId ||
        event.txId !== scope.txId ||
        event.targetId !== next.request.targetId ||
        event.kind !== next.request.kind ||
        event.actorId !== scope.identity.actorId ||
        event.sessionId !== scope.identity.sessionId ||
        (event.kind === "received" &&
          (event.payload.evidence !== "recipient-confirmation" ||
            event.payload.endpointId !==
              (scope.identity.sessionId ?? scope.identity.actorId)))
      ) {
        setState({
          saved: next,
          error: `${result.ok ? "Unsupported response result." : result.error.message} Outcome is unknown; retry only this original response.`,
          unreadable: false,
        });
        return;
      }
      const confirmed = { ...next, event };
      let error: string | null = null;
      try {
        if (read(scope)?.request.idempotencyKey === next.request.idempotencyKey)
          write(scope, confirmed);
      } catch {
        error =
          "Response was recorded, but its confirmation could not be saved. The original response may require replay after reload.";
      }
      setState({ saved: confirmed, error, unreadable: false });
    } catch {
      setState({
        saved: next,
        error:
          "Outcome is unknown; inspect history or retry this original response without a new key.",
        unreadable: false,
      });
    } finally {
      busy.current = false;
      setSending(false);
    }
  }
  function clear() {
    if (!visible || busy.current || acting.pending) return;
    try {
      const raw = sessionStorage.getItem(responseRecoveryKey(scope));
      if (state.unreadable && raw !== unreadableRaw.current) {
        try {
          setState({
            saved: decode(scope, raw),
            error:
              "Recovery changed in another panel. Inspect the current response before clearing it.",
            unreadable: false,
          });
        } catch {
          unreadableRaw.current = raw;
          setState({
            saved: null,
            error:
              "The unreadable recovery record changed. Inspect history again before clearing it.",
            unreadable: true,
          });
        }
        return;
      }
      if (!state.unreadable) {
        const current = decode(scope, raw);
        if (
          current &&
          !current.event &&
          current.request.idempotencyKey !== state.saved?.request.idempotencyKey
        ) {
          setState({
            saved: current,
            error:
              "The pending response changed. Inspect its history before clearing it.",
            unreadable: false,
          });
          return;
        }
      }
      write(scope, null);
      setState({ saved: null, error: null, unreadable: false });
    } catch {
      setState((old) => ({
        ...old,
        error:
          "Recovery storage could not be cleared. Keep the original response for replay.",
      }));
    }
  }
  return {
    ...state,
    send,
    clear,
    pending: sending,
    blocked:
      !visible ||
      acting.pending ||
      sending ||
      state.unreadable ||
      !!(state.saved && !state.saved.event),
  };
}
