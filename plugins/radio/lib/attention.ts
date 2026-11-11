import type { Database } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { requireAuthor } from "./transmission-access.ts";
import { parseProtocol } from "./protocol-contracts.ts";
import { attentionSchema } from "./attention-contracts.ts";
import { discoveryPage, requiredPage } from "./attention-queries.ts";
import { RadioError } from "./errors.ts";

type Domain = Pick<RadioStore, "identities" | "commitments">;
export class Attention {
  private db: Database;
  private store: Domain;
  constructor(db: Database, store: Domain) {
    this.db = db;
    this.store = store;
  }

  check(context: TransmissionContext, input: unknown) {
    requireAuthor(this.store.identities, context);
    const request = parseProtocol(attentionSchema, input);
    const scope = context.scope;
    if (
      scope.projectIds.length > 100 ||
      (scope.currentProjectId &&
        !scope.projectIds.includes(scope.currentProjectId))
    )
      throw new RadioError("forbidden", "Invalid authorized project scope.");
    const projects = [...new Set(scope.projectIds)];
    return this.db.transaction(() => {
      // Recent discovery and durable obligations have independent cursors. The
      // discovery cutoff must never hide required responses or open work.
      const discovery = projects.length
        ? discoveryPage(this.db, context, projects, request)
        : { items: [], nextCursor: request.after, hasMore: false };
      const required = projects.length
        ? requiredPage(this.db, context.authorId, projects, request)
        : { items: [], nextCursor: request.requiredAfter, hasMore: false };
      const commitments = this.store.commitments.list(context, {
        after: request.commitmentAfter,
        limit: request.limit,
      });
      return {
        discovery,
        required,
        commitments,
        pageCounts: {
          discovery: discovery.items.length,
          required: required.items.length,
          commitments: commitments.items.length,
        },
      };
    })();
  }
}
