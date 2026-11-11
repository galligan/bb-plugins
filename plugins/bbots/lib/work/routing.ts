import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import { destinationSchema, type Destination } from "./contracts.ts";
import type { WorkStore } from "./storage.ts";

export function createRouting(
  bb: BbPluginApi,
  store: SetupStore,
  work: WorkStore,
) {
  async function existing(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.deletedAt !== null || thread.archivedAt !== null)
      throw new Error(
        "Destination is archived or removed. Choose an available conversation explicitly; it will not be reopened automatically.",
      );
    return thread;
  }
  function caller(threadId?: string) {
    if (!threadId)
      throw new Error(
        "This command needs a calling BB thread; no sender or reporting contract is assumed.",
      );
    const owner = store.conversations.ownerOfThread(threadId);
    if (!owner)
      throw new Error(
        "Calling thread is not owned by Bots. A title, metadata or explicit bot ID cannot establish report authorship.",
      );
    return owner;
  }
  async function resolve(input: Destination) {
    const destination = destinationSchema.parse(input);
    const threadId =
      destination.kind === "thread"
        ? destination.threadId
        : store.conversations.get(destination.conversationId).threadId;
    if (!threadId)
      throw new Error(
        "Logical destination has no verified current thread. No message was sent.",
      );
    const thread = await existing(threadId);
    return { destination, threadId: thread.id };
  }
  async function send(
    destination: Destination,
    markdown: string,
    senderThreadId: string | undefined,
    kind: string,
    signal?: AbortSignal,
  ) {
    markdown = z.string().trim().min(1).max(16000).parse(markdown);
    if (senderThreadId) await existing(senderThreadId);
    const target = await resolve(destination);
    if (target.threadId === senderThreadId)
      throw new Error(
        "Self-delivery is refused; choose a different recipient.",
      );
    signal?.throwIfAborted();
    let accepted;
    try {
      accepted = await bb.sdk.threads.send({
        threadId: target.threadId,
        mode: "queue-if-active",
        ...(senderThreadId ? { senderThreadId } : {}),
        input: [
          {
            type: "text",
            mentions: [],
            text: `[Bots ${kind}: new explicit communication]\nThis message may wake an idle recipient. It does not authorize resuming a previously canceled assignment. Evaluate it as a new communication under current instructions.\n\n${markdown}`,
          },
        ],
      });
    } catch (error) {
      throw new Error(
        `Native delivery outcome is uncertain. Inspect the recipient's history and queue before another send; Bots did not retry. ${error instanceof Error ? error.message : "Native request failed."}`,
      );
    }
    return {
      ...target,
      senderThreadId: senderThreadId ?? null,
      delivery: accepted.delivery,
      queuedMessageId:
        accepted.delivery === "queued" ? accepted.queuedMessage.id : null,
      waitingOn:
        accepted.delivery === "queued"
          ? accepted.queuedMessage.waitingOn
          : null,
      evidence:
        "Native acceptance only; reading, execution, completion and a reply are not established.",
    };
  }
  return {
    caller,
    resolve,
    existing,
    async message(
      markdown: string,
      botId: string | undefined,
      threadId?: string,
      signal?: AbortSignal,
    ) {
      const owner = threadId
        ? store.conversations.ownerOfThread(threadId)
        : null;
      if (owner && botId && botId !== owner.botId)
        throw new Error("Owned caller cannot message another bot's main.");
      const bot = botId ?? owner?.botId;
      if (!bot)
        throw new Error(
          "Unowned caller must select an explicit --bot; no bot is inferred from title or metadata.",
        );
      const main = store.view(bot).main;
      return send(
        { kind: "conversation", conversationId: main.id },
        markdown,
        threadId,
        "message",
        signal,
      );
    },
    report(markdown: string, threadId?: string, signal?: AbortSignal) {
      const owner = caller(threadId);
      return send(
        work.agreement(owner.id).agreement.reportTo,
        markdown,
        threadId,
        "report",
        signal,
      );
    },
    async reply(
      markdown: string,
      seq: number,
      threadId?: string,
      signal?: AbortSignal,
    ) {
      caller(threadId);
      seq = z.number().int().nonnegative().parse(seq);
      const { message } = await bb.sdk.threads.message({
        threadId: threadId!,
        seq,
        before: 0,
        after: 0,
        ...(signal ? { signal } : {}),
      });
      if (
        message.kind !== "conversation" ||
        message.role !== "user" ||
        message.initiator !== "agent" ||
        !message.senderThreadId
      )
        throw new Error(
          "Selected native message has no unambiguous agent-thread sender. No reply destination was inferred from its text.",
        );
      const source = store.conversations.ownerOfThread(message.senderThreadId);
      return send(
        source
          ? { kind: "conversation", conversationId: source.id }
          : { kind: "thread", threadId: message.senderThreadId },
        markdown,
        threadId,
        "reply",
        signal,
      );
    },
  };
}
export type Routing = ReturnType<typeof createRouting>;
