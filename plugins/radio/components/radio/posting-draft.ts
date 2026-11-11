import { z } from "zod";
import { parseSend, sendSchema } from "../../lib/transmission-contracts.ts";
import type { ActingIdentity } from "./acting-context.ts";

export const fieldsSchema = z
  .object({
    body: z.string().max(2000),
    recipients: z.string().max(26000),
    urls: z.string().max(33000),
    dispatchId: z.string().max(256),
    revision: z.string().max(16),
    requestMode: z.enum(["discussion", "exclusive"]),
    requireAck: z.boolean(),
    expectReply: z.boolean(),
    replyForId: z.string().max(256),
  })
  .strict();
export type PostingFields = z.infer<typeof fieldsSchema>;
export const blankFields = (): PostingFields => ({
  body: "",
  recipients: "",
  urls: "",
  dispatchId: "",
  revision: "",
  requestMode: "discussion",
  requireAck: false,
  expectReply: false,
  replyForId: "",
});
export const draftSchema = z
  .object({
    version: z.literal(1),
    fields: fieldsSchema,
    request: sendSchema.nullable(),
    sentId: z.string().min(1).max(256).nullable(),
  })
  .strict();
export type PostingDraft = z.infer<typeof draftSchema>;
export interface PostingScope {
  identity: ActingIdentity;
  projectId: string;
  channelId: string;
  parent?: { id: string; recipientIds: string[] };
}
export function draftKey(scope: PostingScope) {
  const { identity, projectId, channelId, parent } = scope;
  return `radio-posting-v1:${JSON.stringify([
    identity.stationId,
    projectId,
    identity.actorId,
    identity.sessionId,
    channelId,
    parent?.id ?? null,
  ])}`;
}
export function eligibleReplyTargets(scope: PostingScope) {
  return [
    ...new Set([scope.identity.actorId, scope.identity.sessionId]),
  ].filter(
    (id): id is string => !!id && !!scope.parent?.recipientIds.includes(id),
  );
}
export function makePostingRequest(scope: PostingScope, fields: PostingFields) {
  const targets = eligibleReplyTargets(scope);
  if (targets.length > 1 && !targets.includes(fields.replyForId))
    throw new Error("Choose the one original recipient this reply covers.");
  const refs: NonNullable<z.input<typeof sendSchema>["refs"]> = fields.urls
    .split(/\r?\n/u)
    .map((url) => url.trim())
    .filter(Boolean)
    .map((url) => ({ kind: "url", url }));
  if (fields.dispatchId.trim()) {
    if (fields.revision && !/^[1-9]\d*$/u.test(fields.revision))
      throw new Error("Dispatch revision must be a positive whole number.");
    refs.push({
      kind: "dispatch",
      id: fields.dispatchId.trim(),
      ...(fields.revision ? { revision: Number(fields.revision) } : {}),
    });
  } else if (fields.revision)
    throw new Error("Choose a dispatch before its revision.");
  return parseSend({
    channelId: scope.channelId,
    body: fields.body,
    refs,
    recipientIds: fields.recipients
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean),
    idempotencyKey: crypto.randomUUID(),
    requestMode: fields.requestMode,
    requireAck: fields.requireAck,
    expectReply: fields.expectReply,
    ...(scope.parent ? { replyToId: scope.parent.id } : {}),
    ...(targets.length
      ? { replyForId: targets.length === 1 ? targets[0] : fields.replyForId }
      : {}),
  });
}
/** Only content and canonical routing are saved; authority and credentials never enter this record. */
export function readDraft(scope: PostingScope): PostingDraft {
  return decodeDraft(scope, sessionStorage.getItem(draftKey(scope)));
}
export function decodeDraft(
  scope: PostingScope,
  saved: string | null,
): PostingDraft {
  if (!saved)
    return { version: 1, fields: blankFields(), request: null, sentId: null };
  if (saved.length > 100000) throw new Error("Saved draft exceeds its bound.");
  const draft = draftSchema.parse(JSON.parse(saved));
  if (
    draft.request &&
    (draft.request.channelId !== scope.channelId ||
      (draft.request.replyToId ?? null) !== (scope.parent?.id ?? null))
  )
    throw new Error("Saved draft has a different destination.");
  return draft;
}
export function saveDraft(scope: PostingScope, draft: PostingDraft) {
  sessionStorage.setItem(
    draftKey(scope),
    JSON.stringify(draftSchema.parse(draft)),
  );
}
