import type { BbPluginApi, PluginAgentToolContext } from "@get-bb/plugin-sdk";
import { type Database } from "./contracts.ts";
import type { RadioStore } from "./storage.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import { RadioError } from "./errors.ts";
import { localContextSchema } from "./local-context-contract.ts";
export { localContextSchema } from "./local-context-contract.ts";
import { requireOperator } from "./operator-credential.ts";

/** BB clients share account authority; an explicit thread is attribution, never human authority. */
export class LocalContexts {
  private sdk: Pick<BbPluginApi["sdk"], "threads" | "projects">;
  private db: Database;
  private store: RadioStore;
  private readOperatorSecret: () => Promise<string | undefined>;
  constructor(
    sdk: Pick<BbPluginApi["sdk"], "threads" | "projects">,
    db: Database,
    store: RadioStore,
    readOperatorSecret: () => Promise<string | undefined>,
  ) {
    this.sdk = sdk;
    this.db = db;
    this.store = store;
    this.readOperatorSecret = readOperatorSecret;
  }

  native(context: PluginAgentToolContext): Promise<TransmissionContext> {
    // No model-supplied actor, thread or credential participates in native attribution.
    return this.resolve(
      { threadId: context.threadId, projectId: context.projectId },
      context.signal,
    );
  }

  async resolve(
    input: unknown,
    signal?: AbortSignal,
  ): Promise<TransmissionContext> {
    const parsed = localContextSchema.safeParse(input);
    if (!parsed.success)
      throw new RadioError("invalid_input", "Invalid local Radio context.");
    const request = parsed.data;
    signal?.throwIfAborted();
    if (request.asUser) {
      if (request.threadId || !request.projectId)
        throw new RadioError(
          "invalid_input",
          "Acting as @user requires an explicit project and no acting thread.",
        );
      await requireOperator(
        this.readOperatorSecret,
        request.operatorCredential,
      );
    } else if (request.operatorCredential) {
      throw new RadioError(
        "invalid_input",
        "Use the explicit act-as-user option with an operator credential.",
      );
    } else if (!request.threadId) {
      throw new RadioError(
        "invalid_input",
        "Supply an invoking BB thread with --thread; missing context never selects @user.",
      );
    }
    const thread = request.threadId
      ? await this.sdk.threads.get({ threadId: request.threadId, signal })
      : null;
    signal?.throwIfAborted();
    if (thread && (thread.id !== request.threadId || thread.deletedAt !== null))
      throw new RadioError(
        "not_found",
        "Unknown or deleted invoking BB thread.",
      );
    if (thread && request.projectId && thread.projectId !== request.projectId)
      throw new RadioError(
        "invalid_input",
        "Invoking thread and project must match; choose the intended thread explicitly.",
      );
    const projectId = thread?.projectId ?? request.projectId!;
    const project = await this.sdk.projects.get({ projectId, signal });
    signal?.throwIfAborted();
    if (project.id !== projectId)
      throw new RadioError("not_found", "Unknown invoking BB project.");
    return this.db
      .transaction(() => {
        // Bootstrap together so a qualifier collision or invalid ownership leaves no orphan actor.
        const radioProject = this.store.projects.localProject(
          project.id,
          project.name,
        );
        const scope = {
          projectIds: [radioProject.id],
          currentProjectId: radioProject.id,
        };
        if (request.asUser) {
          const human = this.store.identities.human();
          return {
            caller: { kind: "human" as const, actorId: human.id },
            authorId: human.id,
            scope,
          };
        }
        const session = this.store.identities.localThread(thread!.id, {
          name: (thread!.title ?? thread!.titleFallback)?.slice(0, 256),
        });
        return {
          caller: { kind: "actor" as const, actorId: session.actorId! },
          authorId: session.actorId!,
          sessionId: session.id,
          scope,
        };
      })
      .immediate();
  }
}
