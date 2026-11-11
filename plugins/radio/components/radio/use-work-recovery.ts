import { useRef, useState } from "react";
import { z } from "zod";
import { experimental_useTabVisible } from "@get-bb/plugin-sdk/app";
import {
  commitmentActionSchema,
  type CommitmentAction,
} from "../../lib/commitment-contracts.ts";
import { useActing } from "./acting-context.ts";
import { replaceRecoveryRecord } from "./recovery-storage.ts";
import {
  commitmentOutcomeSchema,
  outcomeMatchesRequest,
  requestMatchesScope,
  workRecoveryKey,
  type WorkScope,
} from "./commitment-result.ts";

const savedSchema = z
  .object({
    version: z.literal(1),
    request: commitmentActionSchema,
    outcome: commitmentOutcomeSchema.nullable(),
  })
  .strict();
type SavedWork = z.infer<typeof savedSchema>;
function decode(scope: WorkScope, raw: string | null): SavedWork | null {
  if (!raw) return null;
  if (raw.length > 30000) throw new Error("Work recovery exceeds its bound.");
  const saved = savedSchema.parse(JSON.parse(raw));
  if (
    !requestMatchesScope(scope, saved.request) ||
    (saved.outcome &&
      !outcomeMatchesRequest(scope, saved.request, saved.outcome))
  )
    throw new Error("Work recovery scope changed.");
  return saved;
}
function read(scope: WorkScope) {
  return decode(scope, sessionStorage.getItem(workRecoveryKey(scope)));
}
function write(scope: WorkScope, saved: SavedWork | null) {
  if (saved)
    sessionStorage.setItem(
      workRecoveryKey(scope),
      JSON.stringify(savedSchema.parse(saved)),
    );
  else sessionStorage.removeItem(workRecoveryKey(scope));
}
export function useWorkRecovery(scope: WorkScope) {
  const acting = useActing();
  const visible = experimental_useTabVisible();
  const unreadableRaw = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<{
    saved: SavedWork | null;
    error: string | null;
    unreadable: boolean;
  }>(() => {
    let raw: string | null | undefined;
    try {
      raw = sessionStorage.getItem(workRecoveryKey(scope));
      return { saved: decode(scope, raw), error: null, unreadable: false };
    } catch {
      unreadableRaw.current = raw;
      return {
        saved: null,
        error:
          "Saved work action could not be read. Inspect work history before clearing recovery.",
        unreadable: true,
      };
    }
  });
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  async function send(input: CommitmentAction, replay = false) {
    if (
      !visible ||
      busy.current ||
      acting.pending ||
      state.unreadable ||
      (state.saved && !state.saved.outcome && !replay)
    )
      return;
    let request: CommitmentAction;
    try {
      request = commitmentActionSchema.parse(input);
      if (!requestMatchesScope(scope, request))
        throw new Error("Choose the current request or commitment.");
    } catch (error) {
      setState((old) => ({
        ...old,
        error:
          error instanceof Error
            ? error.message
            : "Check the work action fields.",
      }));
      return;
    }
    let next: SavedWork;
    try {
      next = { version: 1, request, outcome: null };
      const current = read(scope);
      if (
        current &&
        !current.outcome &&
        current.request.idempotencyKey !==
          (replay ? state.saved?.request.idempotencyKey : undefined)
      ) {
        setState({
          saved: current,
          error:
            "Another panel saved a pending work action. Inspect it or retry its original request.",
          unreadable: false,
        });
        return;
      }
      write(scope, next);
    } catch {
      setState((old) => ({
        ...old,
        error:
          "Recovery storage is unavailable; no new work action was attempted.",
      }));
      return;
    }
    busy.current = true;
    setSending(true);
    setState({ saved: next, error: null, unreadable: false });
    try {
      const result = await acting.perform({ op: "commit", input: request });
      const parsed = result.ok
        ? commitmentOutcomeSchema
            .extend({ replayed: z.boolean() })
            .safeParse(result.data)
        : null;
      if (
        !parsed?.success ||
        !outcomeMatchesRequest(scope, request, parsed.data)
      ) {
        setState({
          saved: next,
          error: `${result.ok ? "Unsupported work result." : result.error.message} Outcome is unknown; inspect history or replay this original action.`,
          unreadable: false,
        });
        return;
      }
      const confirmed: SavedWork = { ...next, outcome: parsed.data };
      let error: string | null = null;
      try {
        if (read(scope)?.request.idempotencyKey === request.idempotencyKey)
          write(scope, confirmed);
      } catch {
        error =
          "Work action was recorded, but its confirmation could not be saved. Its original request may need replay after reload.";
      }
      setState({ saved: confirmed, error, unreadable: false });
    } catch {
      setState({
        saved: next,
        error:
          "Outcome is unknown; inspect work history or retry the original action without a new key.",
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
      if (state.unreadable) {
        const result = replaceRecoveryRecord(
          workRecoveryKey(scope),
          unreadableRaw.current,
          null,
        );
        if (result.replaced)
          setState({ saved: null, error: null, unreadable: false });
        else {
          try {
            setState({
              saved: decode(scope, result.raw),
              error:
                "Work recovery changed in another panel. Inspect its current action before clearing it.",
              unreadable: false,
            });
          } catch {
            unreadableRaw.current = result.raw;
            setState({
              saved: null,
              error:
                "Unreadable work recovery changed. Inspect history again before clearing it.",
              unreadable: true,
            });
          }
        }
        return;
      }
      const current = read(scope);
      if (
        current &&
        !current.outcome &&
        current.request.idempotencyKey !== state.saved?.request.idempotencyKey
      ) {
        setState({
          saved: current,
          error:
            "The pending work action changed. Inspect its history before clearing recovery.",
          unreadable: false,
        });
        return;
      }
      write(scope, null);
      setState({ saved: null, error: null, unreadable: false });
    } catch {
      setState((old) => ({
        ...old,
        error:
          "Work recovery could not be cleared. Keep the original request for replay.",
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
      !!(state.saved && !state.saved.outcome),
  };
}
