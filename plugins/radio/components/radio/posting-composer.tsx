import { useRef, useState } from "react";
import { experimental_useTabVisible } from "@get-bb/plugin-sdk/app";
import { Button } from "../ui/button.tsx";
import { useActing } from "./acting-context.ts";
import { RadioLink } from "./link.tsx";
import { transmissionSchema } from "./view-schemas.ts";
import { PostingFieldsView } from "./posting-fields.tsx";
import {
  blankFields,
  draftKey,
  makePostingRequest,
  readDraft,
  saveDraft,
  type PostingDraft,
  type PostingFields,
  type PostingScope,
} from "./posting-draft.ts";

export function PostingComposer({
  projectId,
  channelId,
  parent,
}: Omit<PostingScope, "identity">) {
  const acting = useActing();
  if (!acting.identity)
    return (
      <p className="text-sm text-muted-foreground">
        Choose a verified acting identity above to post or reply.
      </p>
    );
  const scope = { projectId, channelId, parent, identity: acting.identity };
  return <Composer key={draftKey(scope)} scope={scope} />;
}
function Composer({ scope }: { scope: PostingScope }) {
  const { perform, pending } = useActing();
  const visible = experimental_useTabVisible();
  const [state, setState] = useState<{
    draft: PostingDraft | null;
    error: string | null;
  }>(() => {
    try {
      return { draft: readDraft(scope), error: null };
    } catch {
      return {
        draft: null,
        error:
          "Saved draft could not be read. Check channel history before discarding it; an earlier send may have been accepted.",
      };
    }
  });
  const [checkedHistory, setCheckedHistory] = useState(false);
  const busy = useRef(false);
  const [sending, setSending] = useState(false);
  const draft = state.draft;
  function store(
    next: PostingDraft,
    expectedKey = draft?.request?.idempotencyKey,
  ) {
    if (draft) {
      let current: PostingDraft;
      try {
        current = readDraft(scope);
      } catch {
        setState({
          draft: null,
          error:
            "Saved draft changed or cannot be read. Check channel history before discarding it; no new request was sent.",
        });
        return false;
      }
      if (current.request && current.request.idempotencyKey !== expectedKey) {
        setState({
          draft: current,
          error:
            "Another panel saved a request for this destination. Review that original request before editing or sending again.",
        });
        setCheckedHistory(false);
        return false;
      }
    }
    try {
      saveDraft(scope, next);
      setState({ draft: next, error: null });
      return true;
    } catch {
      setState({
        draft: next,
        error:
          "Draft recovery storage is unavailable. Keep this panel open and check history before retrying; a further request cannot be attempted until it can be saved.",
      });
      return false;
    }
  }
  function edit(fields: PostingFields) {
    if (!draft || draft.request || busy.current) return;
    store({ ...draft, fields });
  }
  async function send() {
    if (!visible || pending || busy.current || !draft || draft.sentId) return;
    let next: PostingDraft;
    try {
      next = {
        ...draft,
        request: draft.request ?? makePostingRequest(scope, draft.fields),
      };
    } catch (error) {
      setState({
        draft,
        error:
          error instanceof Error
            ? error.message
            : "Check the transmission fields.",
      });
      return;
    }
    // Persist the exact request before attempting a write, including on an explicit replay.
    if (!store(next)) return;
    const request = next.request!;
    busy.current = true;
    setSending(true);
    try {
      const result = await perform({
        op: scope.parent ? "reply" : "tx",
        input: request,
      });
      const tx = result.ok ? transmissionSchema.safeParse(result.data) : null;
      if (
        !result.ok ||
        !tx?.success ||
        tx.data.channelId !== scope.channelId ||
        tx.data.authorId !== scope.identity.actorId ||
        tx.data.sessionId !== scope.identity.sessionId ||
        tx.data.body !== request.body ||
        tx.data.replyToId !== (scope.parent?.id ?? null) ||
        tx.data.replyForId !== (request.replyForId ?? null)
      ) {
        setState({
          draft: next,
          error: `${result.ok ? "Radio returned an unrecognized result." : result.error.message} Outcome is not confirmed. Check history or retry the original request.`,
        });
        return;
      }
      const confirmed = { ...next, sentId: tx.data.id };
      // A late response from a closed panel must not overwrite a newer draft in this scope.
      try {
        if (readDraft(scope).request?.idempotencyKey === request.idempotencyKey)
          store(confirmed, request.idempotencyKey);
        else setState({ draft: confirmed, error: null });
      } catch {
        setState({
          draft: confirmed,
          error:
            "Sent was confirmed, but its confirmation could not be saved. Keep the original request key for recovery after reload.",
        });
      }
    } catch {
      setState({
        draft: next,
        error:
          "Outcome is not confirmed. Check history or retry the original request; no new key was created.",
      });
    } finally {
      busy.current = false;
      setSending(false);
    }
  }
  const blocked = !visible || pending || sending;
  const needsHistory = !draft || !!(draft.request && !draft.sentId);
  return (
    <section
      aria-label={scope.parent ? "Reply composer" : "Transmission composer"}
      className="space-y-3 border-t border-border pt-4"
    >
      <h2 className="font-medium">
        {scope.parent ? "Reply" : "Post a transmission"}
      </h2>
      <p className="text-sm break-words">
        Destination:{" "}
        <RadioLink
          route={{
            projectId: scope.projectId,
            kind: "channel",
            id: scope.channelId,
          }}
        >
          {scope.identity.project.name} · {scope.channelId}
        </RadioLink>
      </p>
      <p className="text-xs text-muted-foreground">
        Draft content and original request keys stay in this browser tab for
        recovery, scoped to this station, project, identity and destination.
        Operator credentials are never saved.
      </p>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive break-words">
          {state.error}
        </p>
      ) : null}
      {draft?.sentId ? (
        <p role="status">
          Sent confirmed.{" "}
          <RadioLink
            route={{
              projectId: scope.projectId,
              kind: "transmission",
              id: draft.sentId,
            }}
          >
            Open sent transmission
          </RadioLink>
          . Receipt and work acceptance remain separate.
        </p>
      ) : null}
      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          className="space-y-3"
        >
          <PostingFieldsView
            scope={scope}
            fields={draft.fields}
            disabled={blocked || !!draft.request}
            onChange={edit}
          />
          {!draft.sentId ? (
            <Button type="submit" disabled={blocked}>
              {sending
                ? "Sending…"
                : draft.request
                  ? "Retry original request"
                  : scope.parent
                    ? "Send reply"
                    : "Send transmission"}
            </Button>
          ) : null}
        </form>
      ) : null}
      {draft?.request && !draft.sentId ? (
        <p className="text-xs text-muted-foreground break-all">
          Original request key: {draft.request.idempotencyKey}. Retry uses the
          same content, recipients and destination.
        </p>
      ) : null}
      {needsHistory ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={checkedHistory}
            onChange={(event) => setCheckedHistory(event.target.checked)}
            disabled={blocked}
          />
          I checked channel history and accept that a new request may duplicate
          an earlier accepted transmission.
        </label>
      ) : null}
      <Button
        variant="outline"
        disabled={blocked || (needsHistory && !checkedHistory)}
        onClick={() => {
          if (
            store({
              version: 1,
              fields: blankFields(),
              request: null,
              sentId: null,
            })
          )
            setCheckedHistory(false);
        }}
      >
        {draft?.sentId
          ? "New transmission"
          : needsHistory
            ? "Discard saved request"
            : "Clear draft"}
      </Button>
    </section>
  );
}
