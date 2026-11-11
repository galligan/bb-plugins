import { RadioReads } from "./project-reads.ts";
import { isBrowseOperation } from "./browse-contract.ts";
import type { Database } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { operationSchema } from "./operation-contracts.ts";
import { requireAuthor, requireChannel } from "./transmission-access.ts";
import { RadioError } from "./errors.ts";

/** One validated semantic path for local and trusted-test adapters. */
export class RadioOperations {
  private reads: RadioReads;
  private store: RadioStore;
  constructor(db: Database, store: RadioStore) {
    this.reads = new RadioReads(db, store);
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
    const selectedProjectId = context.scope.currentProjectId;
    if (
      context.scope.projectIds.length > 100 ||
      (selectedProjectId &&
        !context.scope.projectIds.includes(selectedProjectId))
    )
      throw new RadioError("forbidden", "Invalid authorized project scope.");
    const request = parsed.data;
    const store = this.store;
    if (isBrowseOperation(request.op))
      return this.reads.execute(context.scope, request);
    const currentProject = () => {
      if (!selectedProjectId)
        throw new RadioError(
          "invalid_input",
          "Choose a current project for this project-relative operation.",
        );
      return store.projects.get(selectedProjectId);
    };
    switch (request.op) {
      case "whoami": {
        const project = selectedProjectId ? currentProject() : null;
        return {
          stationId: store.stationId,
          actorId: context.authorId,
          sessionId: context.sessionId ?? null,
          project,
          handle: project
            ? store.handles.primary(
                project.id,
                context.sessionId ?? context.authorId,
              )
            : null,
        };
      }
      case "tx":
      case "reply":
        return store.transmissions.send(context, request.input);
      case "check":
        return store.attention.check(context, request.input);
      case "respond":
        return store.responses.record(context, request.input);
      case "commit":
        return store.commitments.act(context, request.input);
      case "commitments":
        return store.commitments.list(context, request.input);
      case "subscribe":
        return store.subscriptions.set(context, request.input);
      case "listening":
        return store.subscriptions.list(context, request.input);
      case "dispatch-create":
        return store.dispatches.create(context, request.input);
      case "dispatch-revise":
        return store.dispatches.revise(context, request.input);
      case "channel-create":
        return store.projects.addSubchannel(
          currentProject().id,
          request.input.name,
        );
      case "channel-rename": {
        requireChannel(store.projects, request.input.id, context.scope);
        return store.projects.renameChannel(
          request.input.id,
          request.input.name,
        );
      }
      case "project-rename":
        return store.projects.rename(currentProject().id, request.input.name);
      case "handle-assign":
      case "handle-rename":
        return store.handles[
          request.op === "handle-assign" ? "assign" : "rename"
        ](
          currentProject().id,
          request.input.targetId ?? context.sessionId ?? context.authorId,
          request.input.name,
          context.caller,
        );
      case "handle-reclaim":
        return store.handles.reclaim(
          currentProject().id,
          request.input.targetId,
          request.input.name,
          context.caller,
        );
      case "alias-remove":
        store.handles.removeAlias(
          currentProject().id,
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
}

export { operationIsRead } from "./operation-contracts.ts";
