import type { PluginStorage } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import { changeSchema } from "../storage/schema.ts";
import { documentName, recordSchema, type RecordBody } from "./contracts.ts";
import { provenance } from "./provenance.ts";

// Called only by the explicit checkpoint restore transaction; ordinary corrections
// retain their current-parent rule. The caller invalidates after the outer commit.
export function restoreKnowledge(storage: PluginStorage, store: SetupStore) {
  const db = storage.database(),
    sources = provenance(storage, store);
  return (
    botId: string,
    id: string,
    expectedRevision: number,
    historical: RecordBody,
    attribution: { author: string; reason: string },
  ) =>
    db
      .transaction(() => {
        store.get(botId);
        const name = documentName(id),
          doc = store.documents.get(botId, name);
        if (!doc) throw new Error("Knowledge record is missing for this bot.");
        const current = recordSchema.parse(JSON.parse(doc.markdown)),
          record = recordSchema.parse(historical);
        if (
          record.kind !== "knowledge" ||
          id !== `mem_${current.requestId}` ||
          record.requestId !== current.requestId ||
          record.creationHash !== current.creationHash
        )
          throw new Error(
            "Only this knowledge record's retained revisions can be restored.",
          );
        if (sources.excluded(botId, name))
          throw new Error("Excluded memory cannot be restored.");
        if (doc.revision !== expectedRevision)
          throw new Error(
            "Memory changed. Read its current revision before restoring.",
          );
        const body = recordSchema.parse({
          ...record,
          sources: sources.resolve(botId, record, id, "historical"),
        });
        const restored = store.documents.write({
          botId,
          name,
          expectedRevision,
          markdown: JSON.stringify(body),
          ...changeSchema.parse(attribution),
        });
        sources.retain(botId, doc.id, body.sources);
        return { id, botId, revision: restored.revision };
      })
      .immediate();
}
