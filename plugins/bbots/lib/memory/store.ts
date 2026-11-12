import { createHash } from "node:crypto";
import { z } from "zod";
import type { PluginStorage } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import { changeSchema } from "../storage/schema.ts";
import {
  creationSchema,
  correctSchema,
  documentName,
  memoryId,
  recordSchema,
  kind,
  type Creation,
  type Correction,
  type RecordBody,
} from "./contracts.ts";
import { provenance, eligibleSql } from "./provenance.ts";
import { captureProgress } from "./capture.ts";
import { restoreKnowledge } from "./restore.ts";
import { captureStreamId } from "./origins.ts";

const limits = {
  historyRetained: true,
  liveContextRefresh: "not-performed",
  independentRestatementDetection: "not-guaranteed",
} as const;

export function openMemory(
  storage: PluginStorage,
  store: SetupStore,
  changed: () => void,
) {
  const db = storage.database(),
    sources = provenance(storage, store),
    progress = captureProgress(store, sources.coversExcluded);
  function document(botId: string, id: string) {
    store.get(botId);
    const doc = store.documents.get(botId, documentName(id));
    if (!doc) throw new Error("Memory record was not found for this bot.");
    return doc;
  }
  function readRecord(doc: ReturnType<typeof document>, id: string) {
    const record = recordSchema.parse(JSON.parse(doc.markdown));
    if (id !== `mem_${record.requestId}`)
      throw new Error("Memory identity differs from its stored record.");
    return record;
  }
  function show(botId: string, id: string) {
    const doc = document(botId, id);
    const metadata = { id, botId, revision: doc.revision };
    if (sources.excluded(botId, doc.name))
      return {
        ...metadata,
        availability: "suppressed" as const,
        limitations: limits,
      };
    return {
      ...metadata,
      availability: "available" as const,
      record: readRecord(doc, id),
      author: doc.author,
      reason: doc.reason,
      updatedAt: doc.createdAt,
    };
  }
  function save(
    botId: string,
    id: string,
    revision: number,
    record: RecordBody,
    attribution: { author: string; reason: string },
  ) {
    const doc = store.documents.write({
      botId,
      name: documentName(id),
      expectedRevision: revision,
      markdown: JSON.stringify(recordSchema.parse(record)),
      author: attribution.author,
      reason: attribution.reason,
    });
    sources.retain(botId, doc.id, record.sources);
    return show(botId, id);
  }
  function create(input: Creation) {
    const value = creationSchema.parse(input),
      id = `mem_${value.requestId}`;
    const hash = createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");
    const result = db
      .transaction(() => {
        store.get(value.botId);
        const previous = store.documents.get(value.botId, documentName(id));
        if (previous) {
          const first = store.documents.revision(value.botId, previous.name, 1);
          if (readRecord(first, id).creationHash !== hash)
            throw new Error(
              "Memory request ID already records different options. Inspect the existing record.",
            );
          return {
            entry: show(value.botId, id),
            replay: true,
            ...(value.kind === "knowledge"
              ? {}
              : {
                  progress: progress.read(
                    value.botId,
                    value.boundary.streamId,
                    value.kind,
                  ),
                }),
          };
        }
        const resolved = sources.resolve(value.botId, {
          ...value,
          sources:
            value.kind === "knowledge"
              ? value.sources
              : [
                  ...value.sources,
                  {
                    streamId: value.boundary.streamId,
                    from: value.boundary.from,
                    through: value.boundary.through,
                  },
                ],
        });
        const body = {
          requestId: value.requestId,
          creationHash: hash,
          kind: value.kind,
          topic: value.topic,
          markdown: value.markdown,
          basis: value.basis,
          sources: resolved,
          parents: value.parents,
          ...(value.kind === "knowledge"
            ? {}
            : {
                boundary: {
                  streamId: value.boundary.streamId,
                  from: value.boundary.from,
                  through: value.boundary.through,
                },
              }),
        };
        const entry = save(value.botId, id, 0, body, value);
        return {
          entry,
          replay: false,
          ...(value.kind === "knowledge"
            ? {}
            : { progress: progress.advance(value, id) }),
        };
      })
      .immediate();
    if (!result.replay) changed();
    return result;
  }
  function correct(input: Correction) {
    const value = correctSchema.parse(input);
    const result = db
      .transaction(() => {
        const doc = document(value.botId, value.id);
        if (sources.excluded(value.botId, doc.name))
          throw new Error(
            "Excluded memory cannot be corrected or restored into retrieval.",
          );
        if (doc.revision !== value.expectedRevision)
          throw new Error(
            "Memory changed. Read its current revision before editing.",
          );
        const before = readRecord(doc, value.id);
        return save(
          value.botId,
          value.id,
          value.expectedRevision,
          {
            ...before,
            topic: value.topic,
            markdown: value.markdown,
            basis: value.basis,
            sources: sources.resolve(
              value.botId,
              {
                ...value,
                sources: before.boundary
                  ? [...value.sources, before.boundary]
                  : value.sources,
              },
              value.id,
            ),
            parents: value.parents,
          },
          value,
        );
      })
      .immediate();
    changed();
    return result;
  }
  function forget(
    botId: string,
    id: string,
    expectedRevision: number,
    author: string,
  ) {
    const attribution = changeSchema.parse({
      author,
      reason: "Explicit forget request",
    });
    expectedRevision = z.number().int().positive().parse(expectedRevision);
    const result = db
      .transaction(() => {
        const doc = document(botId, id);
        if (doc.revision !== expectedRevision)
          throw new Error(
            "Memory changed. Read its current revision before forgetting.",
          );
        sources.forget(botId, doc.name, doc.id, attribution.author);
        return { id, botId, availability: "suppressed", limitations: limits };
      })
      .immediate();
    changed();
    return result;
  }
  function search(
    botId: string,
    input: {
      query?: string;
      kind?: z.infer<typeof kind>;
      after?: string;
      limit?: number;
      streamId?: string;
    } = {},
  ) {
    store.get(botId);
    const query = z
        .string()
        .max(256)
        .parse(input.query ?? ""),
      selectedKind = kind.parse(input.kind ?? "knowledge");
    const limit = z
      .number()
      .int()
      .min(1)
      .max(20)
      .parse(input.limit ?? 10);
    const stream =
      input.streamId === undefined
        ? null
        : captureStreamId.parse(input.streamId);
    let cursor = Number.MAX_SAFE_INTEGER;
    if (input.after) {
      const row = db
        .prepare(
          "SELECT rowid AS cursor FROM documents WHERE bot_id=? AND name=?",
        )
        .get(botId, documentName(input.after)) as
        { cursor: number } | undefined;
      if (!row) throw new Error("Memory cursor was not found for this bot.");
      cursor = row.cursor;
    }
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = db
      .prepare(
        `SELECT d.rowid AS cursor,d.name FROM documents d
      JOIN document_revisions r ON r.document_id=d.id AND r.revision=d.revision
      WHERE d.bot_id=? AND d.name GLOB 'MEMORY:*' AND d.rowid<? AND ${eligibleSql}
      AND json_extract(r.markdown,'$.kind')=?
      AND (? IS NULL OR json_extract(r.markdown,'$.boundary.streamId')=?)
      AND (json_extract(r.markdown,'$.topic') LIKE ? ESCAPE '\\' OR json_extract(r.markdown,'$.markdown') LIKE ? ESCAPE '\\')
      ORDER BY d.rowid DESC LIMIT ?`,
      )
      .all(
        botId,
        cursor,
        selectedKind,
        stream,
        stream,
        pattern,
        pattern,
        limit + 1,
      ) as {
      cursor: number;
      name: string;
    }[];
    const selected = rows.slice(0, limit);
    const items = selected.map((row) => {
      const id = memoryId.parse(`mem_${row.name.slice(7, -5)}`);
      const found = show(botId, id);
      if (found.availability !== "available")
        throw new Error(
          "Memory eligibility changed during retrieval. Read again.",
        );
      return {
        id,
        revision: found.revision,
        kind: found.record.kind,
        topic: found.record.topic,
        basis: found.record.basis,
        excerpt: found.record.markdown.slice(0, 512),
        sources: found.record.sources.slice(0, 4),
        sourceCount: found.record.sources.length,
        boundary: found.record.boundary ?? null,
      };
    });
    return {
      items,
      nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
    };
  }
  return {
    create,
    correct,
    forget,
    restore: restoreKnowledge(storage, store),
    show,
    search,
    progress: progress.read,
  };
}
export type MemoryStore = ReturnType<typeof openMemory>;
