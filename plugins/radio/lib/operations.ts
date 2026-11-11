import type { Database } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { operationSchema, type RadioOperation } from "./operation-contracts.ts";
import { requireAuthor, requireChannel } from "./transmission-access.ts";
import { RadioError } from "./errors.ts";

/** One validated semantic path for local and trusted-test adapters. */
export class RadioOperations {
  private db: Database;
  private store: RadioStore;
  constructor(db: Database, store: RadioStore) {
    this.db = db;
    this.store = store;
  }

  execute(context: TransmissionContext, input: unknown, signal?: AbortSignal) {
    const parsed = operationSchema.safeParse(input);
    if (!parsed.success)
      throw new RadioError(
        "invalid_input",
        `Invalid Radio operation: ${parsed.error.issues[0]!.message}`,
      );
    signal?.throwIfAborted();
    requireAuthor(this.store.identities, context);
    const projectId = context.scope.currentProjectId;
    if (!projectId || !context.scope.projectIds.includes(projectId))
      throw new RadioError(
        "forbidden",
        "Choose an authorized current project.",
      );
    const project = this.store.projects.get(projectId);
    const request = parsed.data;
    const store = this.store;
    switch (request.op) {
      case "whoami":
        return {
          stationId: store.stationId,
          actorId: context.authorId,
          sessionId: context.sessionId ?? null,
          project,
          handle: store.handles.primary(
            projectId,
            context.sessionId ?? context.authorId,
          ),
        };
      case "tx":
      case "reply":
        return store.transmissions.send(context, request.input);
      case "read":
        return store.transmissions.get(request.input.id, context.scope);
      case "scan": {
        const page = store.transmissions.scan(context.scope, request.input);
        return {
          ...page,
          items: page.items.map(
            ({
              id,
              cursor,
              channelId,
              authorId,
              sessionId,
              body,
              createdAt,
              replyToId,
              replyForId,
              requireAck,
              expectReply,
            }) => ({
              id,
              cursor,
              channelId,
              authorId,
              sessionId,
              body,
              createdAt,
              replyToId,
              replyForId,
              requireAck,
              expectReply,
            }),
          ),
        };
      }
      case "check":
        return store.attention.check(context, request.input);
      case "respond":
        return store.responses.record(context, request.input);
      case "responses":
        return store.responses.list(context.scope, request.input);
      case "response-summary":
        return store.responses.summary(context.scope, request.input.txId);
      case "commit":
        return store.commitments.act(context, request.input);
      case "commitments":
        return store.commitments.list(context, request.input);
      case "commitment":
        return store.commitments.get(context.scope, request.input.id);
      case "commitment-events":
        return store.commitments.events(context.scope, request.input);
      case "subscribe":
        return store.subscriptions.set(context, request.input);
      case "listening":
        return store.subscriptions.list(context, request.input);
      case "dispatch-create":
        return store.dispatches.create(context, request.input);
      case "dispatch-revise":
        return store.dispatches.revise(context, request.input);
      case "dispatch-read":
        return store.dispatches.get(context.scope, request.input);
      case "dispatch-list":
        return store.dispatches.list(context.scope, request.input);
      case "channels":
        return this.channels(projectId, request.input);
      case "channel-create":
        return store.projects.addSubchannel(projectId, request.input.name);
      case "channel-rename": {
        requireChannel(store.projects, request.input.id, context.scope);
        return store.projects.renameChannel(
          request.input.id,
          request.input.name,
        );
      }
      case "project-rename":
        return store.projects.rename(projectId, request.input.name);
      case "handles":
        return this.handles(projectId, request.input);
      case "handle-assign":
      case "handle-rename":
        return store.handles[
          request.op === "handle-assign" ? "assign" : "rename"
        ](
          projectId,
          request.input.targetId ?? context.sessionId ?? context.authorId,
          request.input.name,
          context.caller,
        );
      case "handle-reclaim":
        return store.handles.reclaim(
          projectId,
          request.input.targetId,
          request.input.name,
          context.caller,
        );
      case "alias-remove":
        store.handles.removeAlias(
          projectId,
          request.input.name,
          context.caller,
        );
        return { state: "removed" as const };
    }
  }

  /** Small page samples, never global totals or receipt evidence. */
  hint(context: TransmissionContext) {
    const page = this.store.attention.check(context, { limit: 1 });
    return {
      discovery: {
        sampleCount: page.pageCounts.discovery,
        hasMore: page.discovery.hasMore,
      },
      required: {
        sampleCount: page.pageCounts.required,
        hasMore: page.required.hasMore,
      },
      commitments: {
        sampleCount: page.pageCounts.commitments,
        hasMore: page.commitments.hasMore,
      },
    };
  }

  private channels(projectId: string, page: { after: string; limit: number }) {
    const rows = this.db
      .prepare<[string, string, number], { id: string }>(
        "SELECT id FROM channels WHERE project_id = ? AND id > ? ORDER BY id LIMIT ?",
      )
      .all(projectId, page.after, page.limit + 1);
    const items = rows
      .slice(0, page.limit)
      .map(({ id }) => this.store.projects.channel(id));
    return {
      items,
      nextCursor: items.at(-1)?.id ?? page.after,
      hasMore: rows.length > page.limit,
    };
  }

  private handles(projectId: string, page: { after: string; limit: number }) {
    const rows = this.db
      .prepare<[string, string, number], { name: string }>(
        "SELECT name FROM handles WHERE project_id = ? AND name > ? ORDER BY name LIMIT ?",
      )
      .all(projectId, page.after, page.limit + 1);
    const items = rows
      .slice(0, page.limit)
      .map(({ name }) => this.store.handles.lookup(projectId, name)!);
    return {
      items,
      nextCursor: items.at(-1)?.name ?? page.after,
      hasMore: rows.length > page.limit,
    };
  }
}

export function operationIsRead(op: RadioOperation["op"]): boolean {
  return [
    "whoami",
    "read",
    "scan",
    "check",
    "responses",
    "response-summary",
    "commitments",
    "commitment",
    "commitment-events",
    "listening",
    "dispatch-read",
    "dispatch-list",
    "channels",
    "handles",
  ].includes(op);
}
