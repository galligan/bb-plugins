import { useId, useState } from "react";
import { useActing } from "./acting-context.ts";
import { useSubscriptions } from "./use-subscriptions.ts";
import { Button } from "../ui/button.tsx";
import { Pagination } from "./pagination.tsx";
import { RadioLink } from "./link.tsx";

export function SubscriptionPanel({ channelId }: { channelId: string }) {
  const acting = useActing();
  if (!acting.identity) return null;
  return (
    <Targets
      key={JSON.stringify([
        acting.projectId,
        acting.identity.stationId,
        acting.identity.actorId,
        acting.identity.sessionId,
        channelId,
      ])}
      channelId={channelId}
    />
  );
}
function Targets({ channelId }: { channelId: string }) {
  const acting = useActing();
  const identity = acting.identity!;
  const id = useId();
  const [targetId, setTarget] = useState(
    identity.sessionId ?? identity.actorId,
  );
  return (
    <section
      aria-label="Channel subscriptions"
      className="space-y-3 border-t border-border pt-4"
    >
      <h2 className="font-medium">Channel subscriptions</h2>
      <fieldset className="flex flex-wrap gap-3" disabled={acting.pending}>
        <legend className="text-sm mb-2">Listen for</legend>
        {identity.sessionId ? (
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="radio"
              name={id}
              checked={targetId === identity.sessionId}
              onChange={() => setTarget(identity.sessionId!)}
            />
            Acting session
          </label>
        ) : null}
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input
            type="radio"
            name={id}
            checked={targetId === identity.actorId}
            onChange={() => setTarget(identity.actorId)}
          />
          {acting.mode === "operator" ? "Human" : "Actor-wide"}
        </label>
      </fieldset>
      <p className="text-xs text-muted-foreground break-words">
        Selected recipient: <code>{targetId}</code>
      </p>
      <Controls key={targetId} channelId={channelId} targetId={targetId} />
      <p className="text-xs text-muted-foreground">
        Listening applies to this exact channel and starts no agent. Mute or
        unlisten affects future broadcasts and passive discovery; existing
        audiences, direct mentions, required responses and work commitments
        remain.
      </p>
    </section>
  );
}
function Controls({
  channelId,
  targetId,
}: {
  channelId: string;
  targetId: string;
}) {
  const acting = useActing();
  const controls = useSubscriptions(channelId, targetId);
  const [checked, setChecked] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant="outline"
        disabled={controls.blocked}
        onClick={() => void controls.read()}
      >
        Inspect subscriptions
      </Button>
      <p className="text-xs text-muted-foreground">
        Pages show the last manual check for this recipient in the selected
        project. Check again after changes; an absent channel on a page does not
        establish that it is unsubscribed.
      </p>
      {controls.error ? (
        <p role="alert" className="text-sm text-destructive break-words">
          {controls.error} Any displayed page may be out of date.
        </p>
      ) : null}
      {controls.confirmation ? (
        <p role="status" className="text-sm">
          {controls.confirmation} Inspect subscriptions for current state.
        </p>
      ) : null}
      {controls.page ? (
        <>
          {!controls.page.items.length ? (
            <p className="text-sm text-muted-foreground">
              No subscriptions on this page.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {controls.page.items.map((item) => (
                <li key={item.channelId} className="py-2 space-y-1 break-words">
                  <RadioLink
                    route={{
                      projectId: acting.projectId,
                      kind: "channel",
                      id: item.channelId,
                    }}
                  >
                    {item.channelId === channelId
                      ? "This channel"
                      : item.channelId}
                  </RadioLink>
                  <p>
                    {item.muted
                      ? "Muted at last check"
                      : "Listening at last check"}{" "}
                    · Recipient: <code>{item.targetId}</code>
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Pagination
            pending={controls.blocked}
            hasMore={controls.page.hasMore}
            canBack={controls.canBack}
            next={() => void controls.next()}
            back={() => void controls.back()}
            refresh={controls.read}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Inspect subscriptions to load a page.
        </p>
      )}
      <fieldset
        disabled={controls.blocked || controls.uncertain}
        className="flex flex-wrap gap-2"
      >
        <legend className="mb-2 text-sm">
          Change this channel for the selected recipient
        </legend>
        <Button size="sm" onClick={() => void controls.change("listen")}>
          Listen (unmute)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void controls.change("mute")}
        >
          Mute
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void controls.change("unlisten")}
        >
          Unlisten
        </Button>
      </fieldset>
      {controls.uncertain ? (
        <div className="space-y-2 text-sm">
          <p>
            No automatic retry is made. A repeated change could override a newer
            change from another panel.
          </p>
          <label className="flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              disabled={controls.blocked || !controls.inspected}
              checked={checked}
              onChange={(event) => setChecked(event.target.checked)}
            />
            I inspected current subscriptions and want to make a new change.
          </label>
          <Button
            size="sm"
            variant="outline"
            disabled={controls.blocked || !controls.inspected || !checked}
            onClick={() => {
              controls.allowNewChange();
              setChecked(false);
            }}
          >
            Allow a new change
          </Button>
        </div>
      ) : null}
    </div>
  );
}
