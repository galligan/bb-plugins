import type { Database } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { AddressScope } from "./address-resolution.ts";
import { browseOperationSchema } from "./browse-contract.ts";
import { RadioError } from "./errors.ts";

/** Project history reads do not create an actor, receipt, response or work commitment. */
export class RadioReads {
  private db: Database;
  private store: RadioStore;
  constructor(db: Database, store: RadioStore) {
    this.db = db;
    this.store = store;
  }
  execute(scope: AddressScope, input: unknown) {
    const parsed = browseOperationSchema.safeParse(input);
    if (!parsed.success)
      throw new RadioError(
        "invalid_input",
        "Choose a supported read-only Radio operation.",
      );
    const request = parsed.data;
    const store = this.store;
    const currentProjectId = () => {
      if (
        !scope.currentProjectId ||
        !scope.projectIds.includes(scope.currentProjectId)
      )
        throw new RadioError(
          "invalid_input",
          "Choose an authorized current project.",
        );
      return store.projects.get(scope.currentProjectId).id;
    };
    switch (request.op) {
      case "read":
        return store.transmissions.get(request.input.id, scope);
      case "scan": {
        const page = store.transmissions.scan(scope, request.input);
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
      case "responses":
        return store.responses.list(scope, request.input);
      case "response-summary":
        return store.responses.summary(scope, request.input.txId);
      case "commitment":
        return store.commitments.get(scope, request.input.id);
      case "commitment-events":
        return store.commitments.events(scope, request.input);
      case "dispatch-read":
        return store.dispatches.get(scope, request.input);
      case "dispatch-list":
        return store.dispatches.list(scope, request.input);
      case "channels":
        return this.channels(currentProjectId(), request.input);
      case "handle-read":
        return {
          handle: store.handles.lookup(currentProjectId(), request.input.name),
        };
      case "handles":
        return this.handles(currentProjectId(), request.input);

      default:
        throw new RadioError(
          "invalid_input",
          "Choose a supported read-only Radio operation.",
        );
    }
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
