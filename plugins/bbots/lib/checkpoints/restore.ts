import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { MemoryStore } from "../memory/store.ts";
import { documentName, recordSchema } from "../memory/contracts.ts";
import { soulWriteSchema } from "../soul/contracts.ts";
import type { Checkpoints } from "./store.ts";
import {
  restoreSchema,
  receiptSchema,
  type RestoreInput,
} from "./restore-contracts.ts";
import { validateRestoredModels } from "./restore-models.ts";

export function createRestore(
  bb: BbPluginApi,
  store: SetupStore,
  checkpoints: Checkpoints,
  memory: MemoryStore,
  lifecycle: AbortSignal,
  changed: () => void,
) {
  const db = bb.storage.database();
  function name(requestId: string) {
    return `RESTORE:${requestId}.json`;
  }
  function previous(input: RestoreInput, hash: string) {
    const doc = store.documents.get(input.botId, name(input.requestId));
    if (!doc) return null;
    const receipt = receiptSchema.parse(JSON.parse(doc.markdown));
    if (receipt.requestId !== input.requestId || receipt.creationHash !== hash)
      throw new Error("Restore request ID already records different options.");
    return {
      receipt,
      replay: true,
      liveContextRefresh: "not-performed",
      automaticWork: "not-started",
    };
  }
  return async (input: RestoreInput, callerSignal?: AbortSignal) => {
    const value = restoreSchema.parse(input);
    const signal = callerSignal
      ? AbortSignal.any([lifecycle, callerSignal])
      : lifecycle;
    signal.throwIfAborted();
    store.get(value.botId);
    const hash = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
    const replay = previous(value, hash);
    if (replay) return replay;
    const snapshot = checkpoints.show(value.botId, value.checkpointId);
    if (value.selection.some((item) => item.kind === "execution"))
      await validateRestoredModels(
        bb,
        store.get(value.botId).request.hostId,
        snapshot.execution.defaults,
        signal,
      );
    signal.throwIfAborted();
    const result = db
      .transaction(() => {
        signal.throwIfAborted();
        const found = previous(value, hash);
        if (found) return found;
        const writes = value.selection.map((item) => {
          const attribution = { author: value.author, reason: value.reason };
          if (item.kind === "profile") {
            const bot = store.profiles.rename({
              botId: value.botId,
              expectedRevision: item.expectedRevision,
              name: snapshot.profile.name,
              ...attribution,
            });
            return {
              kind: item.kind,
              id: bot.id,
              fromRevision: item.expectedRevision,
              toRevision: bot.revision,
            };
          }
          if (item.kind === "execution") {
            const doc = store.documents.write({
              botId: value.botId,
              name: "EXECUTION.json",
              expectedRevision: item.expectedRevision,
              markdown: JSON.stringify(snapshot.execution.defaults),
              ...attribution,
            });
            return {
              kind: item.kind,
              id: doc.id,
              fromRevision: item.expectedRevision,
              toRevision: doc.revision,
            };
          }
          const target =
            item.kind === "soul" ? "SOUL.md" : documentName(item.id);
          const historical = checkpoints.selectedDocument(
            value.botId,
            value.checkpointId,
            target,
          );
          if (item.kind === "soul") {
            const checked = soulWriteSchema.parse({
              botId: value.botId,
              expectedRevision: item.expectedRevision,
              markdown: historical.markdown,
              ...attribution,
            });
            const doc = store.documents.write({ ...checked, name: "SOUL.md" });
            return {
              kind: item.kind,
              id: doc.id,
              fromRevision: item.expectedRevision,
              toRevision: doc.revision,
            };
          }
          const restored = memory.restore(
            value.botId,
            item.id,
            item.expectedRevision,
            recordSchema.parse(JSON.parse(historical.markdown)),
            attribution,
          );
          return {
            kind: item.kind,
            id: item.id,
            fromRevision: item.expectedRevision,
            toRevision: restored.revision,
          };
        });
        const receipt = receiptSchema.parse({
          requestId: value.requestId,
          checkpointId: value.checkpointId,
          creationHash: hash,
          author: value.author,
          reason: value.reason,
          createdAt: new Date().toISOString(),
          writes,
        });
        store.documents.write({
          botId: value.botId,
          name: name(value.requestId),
          expectedRevision: 0,
          markdown: JSON.stringify(receipt),
          author: value.author,
          reason: value.reason,
        });
        return {
          receipt,
          replay: false,
          liveContextRefresh: "not-performed",
          automaticWork: "not-started",
        };
      })
      .immediate();
    if (!result.replay) changed();
    return {
      ...result,
      managedTitlesPending: store.titlePending(value.botId),
      limitation:
        "Only selected revisions changed. Native titles may await explicit reconciliation; applied SOUL is unknown and live sessions were not refreshed. No task/commitment/cursor/routing/action was restored.",
    };
  };
}
