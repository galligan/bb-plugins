import type { PluginStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import { changeSchema, type Change } from "../storage/schema.ts";
import {
  commitmentIdSchema,
  commitmentSchema,
  referenceSchema,
  type Commitment,
  type Reference,
} from "./contracts.ts";

const prefix = "COMMITMENT:";
function name(id: string) {
  return prefix + commitmentIdSchema.parse(id).slice(4) + ".json";
}
export function openCommitments(
  storage: PluginStorage,
  store: SetupStore,
  changed: () => void,
) {
  const db = storage.database();
  function get(botId: string, id: string) {
    store.get(botId);
    const doc = store.documents.get(botId, name(id));
    if (!doc) throw new Error("Commitment was not found for this bot.");
    const record = commitmentSchema.parse(JSON.parse(doc.markdown));
    if (id !== `cmt_${record.requestId}`)
      throw new Error("Commitment ID differs from its recorded identity.");
    return {
      id,
      botId,
      revision: doc.revision,
      record,
      author: doc.author,
      reason: doc.reason,
      updatedAt: doc.createdAt,
    };
  }
  function write(
    botId: string,
    id: string,
    revision: number,
    record: Commitment,
    attribution: Change,
  ) {
    const input = commitmentSchema.parse(record);
    if (store.conversations.get(input.ownerConversationId).botId !== botId)
      throw new Error("Commitment owner must belong to the same bot.");
    store.documents.write({
      botId,
      name: name(id),
      expectedRevision: revision,
      markdown: JSON.stringify(input),
      ...changeSchema.parse({
        author: attribution.author,
        reason: attribution.reason,
      }),
    });
    changed();
    return get(botId, id);
  }
  function current(botId: string, id: string, revision: number) {
    revision = z.number().int().positive().parse(revision);
    const found = get(botId, id);
    if (found.revision !== revision)
      throw new Error("Commitment changed. Read it before editing.");
    return found;
  }
  return {
    get,
    originalReference(botId: string, requestId: string) {
      store.get(botId);
      const documentName = name(`cmt_${requestId}`);
      if (!store.documents.get(botId, documentName)) return null;
      const first = store.documents.revision(botId, documentName, 1);
      return commitmentSchema.parse(JSON.parse(first.markdown)).reference;
    },
    add(botId: string, record: Commitment, attribution: Change) {
      record = commitmentSchema.parse(record);
      attribution = changeSchema.parse({
        author: attribution.author,
        reason: attribution.reason,
      });
      const id = `cmt_${record.requestId}`;
      const existing = store.documents.get(botId, name(id));
      if (existing) {
        const first = store.documents.revision(botId, name(id), 1);
        if (
          JSON.stringify(commitmentSchema.parse(JSON.parse(first.markdown))) !==
            JSON.stringify(record) ||
          first.author !== attribution.author ||
          first.reason !== attribution.reason
        )
          throw new Error(
            "Commitment request ID already records different options. Inspect the original obligation instead of duplicating it.",
          );
        return get(botId, id);
      }
      return write(botId, id, 0, record, attribution);
    },
    list(botId: string, after?: string, limit = 20) {
      store.get(botId);
      limit = z.number().int().min(1).max(20).parse(limit);
      let cursor = Number.MAX_SAFE_INTEGER;
      if (after) {
        const row = db
          .prepare(
            "SELECT rowid AS cursor FROM documents WHERE bot_id = ? AND name = ?",
          )
          .get(botId, name(after));
        if (!row)
          throw new Error("Commitment cursor was not found for this bot.");
        cursor = z
          .object({ cursor: z.number().int().positive() })
          .parse(row).cursor;
      }
      const rows = z
        .array(z.object({ name: z.string() }))
        .parse(
          db
            .prepare(
              "SELECT name FROM documents WHERE bot_id = ? AND name GLOB 'COMMITMENT:*' AND rowid < ? ORDER BY rowid DESC LIMIT ?",
            )
            .all(botId, cursor, limit + 1),
        );
      const records = rows
        .slice(0, limit)
        .map((row) => get(botId, `cmt_${row.name.slice(prefix.length, -5)}`));
      return {
        records,
        nextCursor: rows.length > limit ? records.at(-1)!.id : null,
      };
    },
    close(botId: string, id: string, revision: number, attribution: Change) {
      const found = current(botId, id, revision);
      if (found.record.reference.kind !== "unlinked")
        throw new Error(
          "Linked task status belongs to its source. Update or inspect that source; Bots will not close a shadow status.",
        );
      if (found.record.reference.status === "closed") return found;
      return write(
        botId,
        id,
        revision,
        { ...found.record, reference: { kind: "unlinked", status: "closed" } },
        attribution,
      );
    },
    relink(
      botId: string,
      id: string,
      revision: number,
      reference: Reference,
      attribution: Change,
    ) {
      const found = current(botId, id, revision);
      reference = referenceSchema.parse(reference);
      if (reference.kind === "unlinked")
        throw new Error(
          "Relinking requires an external source; it cannot create a shadow task status.",
        );
      return write(
        botId,
        id,
        revision,
        { ...found.record, reference },
        attribution,
      );
    },
  };
}
export type CommitmentStore = ReturnType<typeof openCommitments>;
