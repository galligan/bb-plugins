import { z } from "zod";
import { Deadline, OperationAborted } from "../deadline.ts";
import { sourceSchema } from "../sets-schema.ts";
import { idSchema } from "../contracts.ts";
import { commands, goal, recentUsers } from "./history.ts";
import {
  normalizedEventSchema,
  SourceFailure,
  sourceValue,
  type SourceContext,
  type SourceResult,
  type SourceSdk,
} from "./contracts.ts";

export class SourceService {
  private sdk: SourceSdk;
  private disposal = new AbortController();
  constructor(sdk: SourceSdk) {
    this.sdk = sdk;
  }
  dispose(): void {
    this.disposal.abort();
  }

  async read(value: unknown, context: SourceContext): Promise<SourceResult> {
    const definition = sourceSchema.parse(value);
    if (context.threadId !== undefined) idSchema.parse(context.threadId);
    if (context.projectId !== undefined) idSchema.parse(context.projectId);
    const event =
      context.event === undefined
        ? undefined
        : normalizedEventSchema.parse(context.event);
    const idle =
      context.idle === undefined
        ? undefined
        : z
            .strictObject({ lastAssistantText: z.string().nullable() })
            .parse(context.idle);
    const scope = new Deadline({
      deadlineAt: context.deadlineAt ?? performance.now() + 5_000,
      signals: [context.signal, this.disposal.signal],
    });
    try {
      return await scope.run(async () => {
        if (definition.from.startsWith("event.")) {
          if (
            !event ||
            (context.threadId && context.threadId !== event.threadId) ||
            (context.projectId && context.projectId !== event.projectId)
          )
            throw new SourceFailure("event_unavailable");
          const field = definition.from.slice(6) as Exclude<
            keyof typeof event,
            "kind"
          >;
          const projected = event[field];
          if (projected === undefined || projected === null)
            throw new SourceFailure("event_field_missing");
          return sourceValue(projected, definition, field === "error");
        }
        if (definition.from.startsWith("git."))
          throw new SourceFailure("git_source_unavailable");
        if (
          definition.from === "project.name" &&
          context.projectId &&
          !context.threadId
        ) {
          const project = z.object({ id: z.string(), name: z.string() }).parse(
            await this.sdk.projects.get({
              projectId: context.projectId,
              signal: scope.signal,
            }),
          );
          if (project.id !== context.projectId)
            throw new SourceFailure("project_mismatch");
          return sourceValue(project.name, definition, true);
        }
        if (!context.threadId) throw new SourceFailure("thread_required");
        const thread = z
          .object({
            id: z.string(),
            projectId: z.string(),
            title: z.string().nullable(),
            providerId: z.string().min(1),
          })
          .parse(
            await this.sdk.threads.get({
              threadId: context.threadId,
              signal: scope.signal,
            }),
          );
        scope.assertActive();
        if (
          thread.id !== context.threadId ||
          (context.projectId && context.projectId !== thread.projectId)
        )
          throw new SourceFailure("thread_context_mismatch");
        switch (definition.from) {
          case "thread.title":
            if (thread.title === null) throw new SourceFailure("title_missing");
            return sourceValue(thread.title, definition, true);
          case "provider.id":
            return sourceValue(
              thread.providerId,
              definition,
              !["codex", "claude-code", "pi"].includes(thread.providerId),
            );
          case "provider.model": {
            const execution = z.object({ model: z.string().min(1) }).parse(
              await this.sdk.threads.defaultExecutionOptions({
                threadId: context.threadId,
                signal: scope.signal,
              }),
            );
            return sourceValue(execution.model, definition, true);
          }
          case "project.name": {
            const project = z
              .object({ id: z.string(), name: z.string() })
              .parse(
                await this.sdk.projects.get({
                  projectId: thread.projectId,
                  signal: scope.signal,
                }),
              );
            if (project.id !== thread.projectId)
              throw new SourceFailure("project_mismatch");
            return sourceValue(project.name, definition, true);
          }
          case "thread.lastAssistantText": {
            const output =
              idle !== undefined
                ? idle.lastAssistantText
                : z.object({ output: z.string().nullable() }).parse(
                    await this.sdk.threads.output({
                      threadId: context.threadId,
                      signal: scope.signal,
                    }),
                  ).output;
            if (output === null)
              throw new SourceFailure("assistant_text_missing");
            return sourceValue(output, definition, true);
          }
          case "thread.commands":
          case "thread.commandOutput":
            return commands(
              this.sdk,
              context.threadId,
              definition,
              scope.signal,
            );
          case "thread.recentUserMessages":
            return recentUsers(
              this.sdk,
              context.threadId,
              definition,
              scope.signal,
            );
          case "thread.goal":
            return goal(this.sdk, context.threadId, definition, scope.signal);
          default:
            throw new SourceFailure("unsupported_source");
        }
      });
    } catch (error) {
      if (error instanceof OperationAborted)
        return {
          status: "unavailable",
          reason: error.reason,
          code: error.reason,
        };
      if (error instanceof SourceFailure)
        return {
          status: "unavailable",
          reason: error.reason,
          code: error.code,
        };
      return {
        status: "unavailable",
        reason: "source_unavailable",
        code: "source_read_failed",
      };
    } finally {
      scope.close();
    }
  }
}
