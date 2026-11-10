import { z } from "zod";
import {
  answersSchema,
  idSchema,
  parseResponse,
  strictRecord,
  type Questions,
} from "./contracts.ts";
import { hashSchema } from "./results.ts";
import {
  assertJson,
  assertLossless,
  canonicalJson,
  hashJson,
  LIMITS,
  type Json,
} from "./json.ts";
import { persist, PersistenceError, type Database } from "./persistence.ts";
import type { InferenceResult } from "./transports/systemone.ts";

export const CACHE_TTL_MS = 60_000;
export const CACHE_ENTRIES = 1000;
const descriptorSchema = z.strictObject({
  version: z.literal(1),
  transport: z.enum(["system-one-v1", "workers-ai-v1"]),
  modelFingerprint: hashSchema,
  questionsHash: hashSchema,
  stateHash: hashSchema,
});
export function cacheDescriptor(
  modelFingerprint: string,
  cloudflare: boolean,
  questions: Questions,
  state: Json,
) {
  const descriptor = descriptorSchema.parse({
    version: 1,
    transport: cloudflare ? "workers-ai-v1" : "system-one-v1",
    modelFingerprint,
    questionsHash: hashJson(questions),
    stateHash: hashJson(state),
  });
  return {
    key: hashJson(descriptor),
    descriptor,
    // Diagnostics only: the cache never splits a batch into per-question entries.
    questionHashes: Object.fromEntries(
      Object.entries(questions).map(([id, q]) => [id, hashJson(q)]),
    ),
  };
}
export type CacheDescriptor = ReturnType<typeof cacheDescriptor>;
const entrySchema = z.strictObject({
  descriptor: descriptorSchema,
  questionHashes: strictRecord(idSchema, hashSchema),
  providerModel: z.string().min(1).max(256),
  answers: answersSchema,
});
function parseEntry(
  value: unknown,
  request: CacheDescriptor,
  questions: Questions,
) {
  // Answers retain their original root depth; the descriptor adds no answer wrapper.
  assertJson(value, LIMITS.responseBytes);
  const entry = entrySchema.parse(value);
  assertLossless(value, entry, LIMITS.responseBytes);
  if (
    hashJson(entry.descriptor) !== request.key ||
    canonicalJson(entry.questionHashes) !==
      canonicalJson(request.questionHashes)
  )
    throw new PersistenceError();
  const response = parseResponse(
    { model: entry.providerModel, answers: entry.answers },
    questions,
  );
  return { entry, response };
}

/** Typed whole-batch responses only. No input state, credentials or outages; score legends remain typed answers. */
export class ResponseCache {
  private db: Database;
  constructor(db: Database) {
    this.db = db;
  }
  get(request: CacheDescriptor, questions: Questions, now = Date.now()) {
    return persist(() => {
      const row = this.db
        .prepare("SELECT created_at, response_json FROM cache WHERE key = ?")
        .get(request.key) as
        { created_at: number; response_json: string } | undefined;
      if (!row) return null;
      if (!Number.isSafeInteger(row.created_at) || row.created_at < 0)
        throw new PersistenceError();
      // Wall-clock rollback must not extend an entry's lifetime.
      if (now < row.created_at || now - row.created_at >= CACHE_TTL_MS)
        return null;
      return parseEntry(JSON.parse(row.response_json), request, questions)
        .response;
    });
  }
  put(
    request: CacheDescriptor,
    questions: Questions,
    result: Extract<InferenceResult, { status: "ran" }>,
    now = Date.now(),
  ): void {
    const value = {
      descriptor: request.descriptor,
      questionHashes: request.questionHashes,
      providerModel: result.providerModel,
      answers: result.answers,
    };
    // A valid response may leave no room for diagnostic hashes; return it uncached.
    if (Buffer.byteLength(JSON.stringify(value)) > LIMITS.responseBytes) return;
    const { entry } = parseEntry(value, request, questions);
    persist(() =>
      this.db.transaction(() => {
        this.db
          .prepare(
            "INSERT INTO cache(key, created_at, response_json) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET created_at=excluded.created_at, response_json=excluded.response_json",
          )
          .run(request.key, now, JSON.stringify(entry));
        this.db
          .prepare("DELETE FROM cache WHERE created_at <= ? OR created_at > ?")
          .run(now - CACHE_TTL_MS, now);
        this.db
          .prepare(
            "DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY created_at DESC, key DESC LIMIT -1 OFFSET ?)",
          )
          .run(CACHE_ENTRIES);
      })(),
    );
  }
}
