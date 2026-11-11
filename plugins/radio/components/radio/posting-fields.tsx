import { useId } from "react";
import { Input } from "../ui/input.tsx";
import { Textarea } from "../ui/textarea.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.tsx";
import {
  eligibleReplyTargets,
  type PostingFields,
  type PostingScope,
} from "./posting-draft.ts";

export function PostingFieldsView({
  scope,
  fields,
  disabled,
  onChange,
}: {
  scope: PostingScope;
  fields: PostingFields;
  disabled: boolean;
  onChange: (fields: PostingFields) => void;
}) {
  const id = useId();
  const targets = eligibleReplyTargets(scope);
  const update = <K extends keyof PostingFields>(
    key: K,
    value: PostingFields[K],
  ) => onChange({ ...fields, [key]: value });
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-3">
      <div className="space-y-1">
        <label htmlFor={`${id}-body`} className="text-sm font-medium">
          Transmission
        </label>
        <Textarea
          id={`${id}-body`}
          value={fields.body}
          maxLength={2000}
          rows={3}
          onChange={(event) => update("body", event.target.value)}
          aria-describedby={`${id}-count`}
        />
        <p id={`${id}-count`} className="text-xs text-muted-foreground">
          {[...fields.body].length}/400 characters. Address handles in the body;
          use @ch:project/subchannel to broadcast. No audience is inherited from
          a parent reply.
        </p>
      </div>
      {targets.length > 1 ? (
        <div className="space-y-1">
          <label htmlFor={`${id}-coverage`} className="text-sm">
            Original recipient this reply covers
          </label>
          <Select
            disabled={disabled}
            value={fields.replyForId || undefined}
            onValueChange={(value) => update("replyForId", value)}
          >
            <SelectTrigger id={`${id}-coverage`} className="w-full">
              <SelectValue placeholder="Choose one recipient" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((target) => (
                <SelectItem key={target} value={target}>
                  {target === scope.identity.actorId
                    ? "Actor"
                    : "Acting session"}{" "}
                  · {target}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : targets.length === 1 ? (
        <p className="text-xs text-muted-foreground">
          Reply coverage: {targets[0]}. Other recipient obligations stay open.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fields.requireAck}
            onChange={(event) => update("requireAck", event.target.checked)}
          />
          Request ack
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={fields.expectReply}
            onChange={(event) => update("expectReply", event.target.checked)}
          />
          Request reply
        </label>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-mode`} className="text-sm">
          Request mode
        </label>
        <Select
          disabled={disabled}
          value={fields.requestMode}
          onValueChange={(value) =>
            update("requestMode", value as PostingFields["requestMode"])
          }
        >
          <SelectTrigger id={`${id}-mode`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="discussion">Discussion</SelectItem>
            <SelectItem value="exclusive">Exclusive request</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          An exclusive request allows one work claimant. Sending alone accepts
          no work and starts no agent.
        </p>
      </div>
      <details className="space-y-3 text-sm">
        <summary className="cursor-pointer">
          References and canonical recipients
        </summary>
        <div className="space-y-1 pt-2">
          <label htmlFor={`${id}-urls`}>
            External references (one HTTP(S) URL per line)
          </label>
          <Textarea
            id={`${id}-urls`}
            value={fields.urls}
            rows={2}
            maxLength={33000}
            onChange={(event) => update("urls", event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-dispatch`}>
            Dispatch reference (canonical ID, optional)
          </label>
          <Input
            id={`${id}-dispatch`}
            value={fields.dispatchId}
            maxLength={256}
            onChange={(event) => update("dispatchId", event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-revision`}>
            Pinned dispatch revision (optional)
          </label>
          <Input
            id={`${id}-revision`}
            value={fields.revision}
            maxLength={16}
            inputMode="numeric"
            onChange={(event) => update("revision", event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-recipients`}>
            Additional canonical recipient IDs (comma or space separated)
          </label>
          <Input
            id={`${id}-recipients`}
            value={fields.recipients}
            maxLength={26000}
            onChange={(event) => update("recipients", event.target.value)}
          />
        </div>
      </details>
    </fieldset>
  );
}
