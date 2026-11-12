import type { PluginStorage } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import type { MemoryStore } from "../memory/store.ts";
import type { Checkpoints } from "../checkpoints/store.ts";
import type { Origin } from "../memory/origins.ts";
import { recordsContract } from "./records-contracts.ts";
import { recordIdentity } from "./record-identity.ts";

const sourceLabel = (source: Origin) =>
  typeof source === "string"
    ? source
    : `${source.streamId} · ${source.from}–${source.through}`;

export function createRecords(
  storage: PluginStorage,
  store: SetupStore,
  memory: MemoryStore,
  checkpoints: Checkpoints,
) {
  return {
    index(input: z.input<typeof recordsContract.botRecords.input>) {
      const value = recordsContract.botRecords.input.parse(input);
      return storage.database().transaction(() => {
        const identity = recordIdentity(store, value.threadId);
        const page = memory.search(identity.botId, {
          kind: value.kind,
          query: value.query,
          after: value.memoryAfter,
          limit: 10,
        });
        return recordsContract.botRecords.output.parse({
          ...identity,
          memory: {
            ...page,
            items: page.items.map((item) => ({
              id: item.id,
              revision: item.revision,
              kind: item.kind,
              topic: item.topic,
              basis: item.basis,
              excerpt: item.excerpt,
              sourceCount: item.sourceCount,
              sources: item.sources.map(sourceLabel),
            })),
          },
          checkpoints: checkpoints.list(identity.botId, value.checkpointAfter),
        });
      })();
    },
    note(input: z.input<typeof recordsContract.botMemory.input>) {
      const value = recordsContract.botMemory.input.parse(input);
      return storage.database().transaction(() => {
        const identity = recordIdentity(store, value.threadId);
        const found = memory.show(identity.botId, value.id);
        if (found.availability === "suppressed")
          return recordsContract.botMemory.output.parse({
            ...identity,
            id: found.id,
            availability: "suppressed",
          });
        const record = found.record;
        return recordsContract.botMemory.output.parse({
          ...identity,
          availability: "available",
          note: {
            id: found.id,
            revision: found.revision,
            kind: record.kind,
            topic: record.topic,
            basis: record.basis,
            markdown: record.markdown,
            sources: record.sources.slice(0, 20).map(sourceLabel),
            sourceCount: record.sources.length,
          },
        });
      })();
    },
  };
}
