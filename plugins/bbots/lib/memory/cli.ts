import { cliCommand, type PluginCliContext } from "@get-bb/plugin-sdk";
import type { SetupStore } from "../setup/storage.ts";
import type { MemoryStore } from "./store.ts";
import { creationSchema, correctSchema } from "./contracts.ts";

const bot = [
  { name: "botId", description: "Stable bot ID", required: true },
] as const;
const entry = [
  ...bot,
  { name: "memoryId", description: "Stable mem_ record ID", required: true },
] as const;
const json = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;
const revision = {
  type: "integer",
  required: true,
  min: 0,
  max: Number.MAX_SAFE_INTEGER,
  description: "Expected current record or capture-progress revision",
} as const;
const content = {
  topic: {
    type: "string",
    required: true,
    description: "Topic, at most 128 characters",
  },
  markdown: {
    type: "string",
    required: true,
    description: "Complete note/capture, at most 8,192 characters",
  },
  basis: {
    type: "enum",
    values: ["fact", "inference"],
    required: true,
    description: "Keep inferred observations distinct from facts",
  },
  source: {
    type: "string",
    repeatable: true,
    description:
      "Original thread:/artifact:/task:/user: identifier, not forgotten text or a shared-memory mirror; up to 64",
  },
  parents: {
    type: "string",
    description:
      'JSON array of up to 16 {id:"mem_...",revision:1} provenance parents; original sources are inherited',
  },
  author: {
    type: "string",
    required: true,
    description: "Truthful person or agent recording the change",
  },
  reason: {
    type: "string",
    required: true,
    description: "Instruction or evidence motivating this change",
  },
  json,
} as const;
const request = {
  type: "string",
  required: true,
  description:
    "Retained UUID; identical replay recovers current state without duplicate capture",
} as const;
const capture = {
  kind: {
    type: "enum",
    values: ["state", "decision", "summary"],
    required: true,
    description:
      "In-turn recent state/decision/summary, separate from durable knowledge",
  },
  stream: {
    type: "string",
    required: true,
    description:
      "Whole-thread/original stream identifier; cite messages as sources; progress is per kind",
  },
} as const;
function parents(value: string | undefined): unknown {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Parents must be JSON {id,revision} references.");
  }
}
function result(value: unknown) {
  return { exitCode: 0, stdout: JSON.stringify(value, null, 2) + "\n" };
}
export function memoryCommands(
  memory: MemoryStore,
  store: SetupStore,
  lifecycle: AbortSignal,
) {
  function caller(botId: string, ctx: PluginCliContext) {
    lifecycle.throwIfAborted();
    ctx.signal?.throwIfAborted();
    const owner = ctx.threadId
      ? store.conversations.ownerOfThread(ctx.threadId)
      : null;
    if (owner && owner.botId !== botId)
      throw new Error(
        "Owned caller cannot read or change another bot's memory.",
      );
  }
  return {
    "memory remember": cliCommand({
      summary:
        "Remember attributable durable knowledge; starts no provider turn",
      positionals: bot,
      options: { ...content, "request-id": request },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          memory.create(
            creationSchema.parse({
              botId: positionals.botId,
              kind: "knowledge",
              requestId: options["request-id"],
              topic: options.topic,
              markdown: options.markdown,
              basis: options.basis,
              sources: options.source ?? [],
              parents: parents(options.parents),
              author: options.author,
              reason: options.reason,
            }),
          ),
        );
      },
    }),
    "memory correct": cliCommand({
      summary:
        "Append a complete revision-checked correction; cannot resurrect excluded provenance",
      positionals: entry,
      options: { ...content, revision },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          memory.correct(
            correctSchema.parse({
              botId: positionals.botId,
              id: positionals.memoryId,
              expectedRevision: options.revision,
              topic: options.topic,
              markdown: options.markdown,
              basis: options.basis,
              sources: options.source ?? [],
              parents: parents(options.parents),
              author: options.author,
              reason: options.reason,
            }),
          ),
        );
      },
    }),
    "memory forget": cliCommand({
      summary:
        "Suppress record, known sources and derived results; history/live context are not erased",
      positionals: entry,
      options: { revision, author: content.author, json },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          memory.forget(
            positionals.botId,
            positionals.memoryId,
            options.revision,
            options.author,
          ),
        );
      },
    }),
    "memory show": cliCommand({
      summary: "Read one current record or its content-free suppression state",
      positionals: entry,
      options: { json },
      run({ positionals }, ctx) {
        caller(positionals.botId, ctx);
        return result(memory.show(positionals.botId, positionals.memoryId));
      },
    }),
    "memory search": cliCommand({
      summary: "Bounded topic/text retrieval, excluding forgotten provenance",
      positionals: bot,
      options: {
        json,
        query: {
          type: "string",
          description: "Literal topic/text, at most 256 characters",
        },
        kind: {
          type: "enum",
          values: ["knowledge", "state", "decision", "summary"],
          default: "knowledge",
          description: "Select durable knowledge or a capture kind",
        },
        limit: {
          type: "integer",
          min: 1,
          max: 20,
          default: 10,
          description: "Maximum returned entries",
        },
        after: {
          type: "string",
          description: "Stable nextCursor from the previous page",
        },
      },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          memory.search(positionals.botId, {
            query: options.query,
            kind: options.kind,
            limit: options.limit,
            after: options.after,
          }),
        );
      },
    }),
    capture: cliCommand({
      summary:
        "Capture recent state/decision/summary and progress inside this authorized turn; sends nothing",
      positionals: bot,
      options: {
        ...content,
        ...capture,
        revision,
        "request-id": request,
        from: {
          type: "integer",
          required: true,
          min: 1,
          max: Number.MAX_SAFE_INTEGER,
          description: "First unprocessed sequence, initially 1",
        },
        through: {
          type: "integer",
          required: true,
          min: 1,
          max: Number.MAX_SAFE_INTEGER,
          description: "Last processed source sequence",
        },
      },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          memory.create(
            creationSchema.parse({
              botId: positionals.botId,
              kind: options.kind,
              requestId: options["request-id"],
              topic: options.topic,
              markdown: options.markdown,
              basis: options.basis,
              sources: options.source ?? [],
              parents: parents(options.parents),
              author: options.author,
              reason: options.reason,
              boundary: {
                streamId: options.stream,
                from: options.from,
                through: options.through,
                expectedRevision: options.revision,
              },
            }),
          ),
        );
      },
    }),
    "capture progress": cliCommand({
      summary:
        "Read durable processed boundary without starting consolidation or another turn",
      positionals: bot,
      options: { ...capture, json },
      run({ positionals, options }, ctx) {
        caller(positionals.botId, ctx);
        return result(
          memory.progress(positionals.botId, options.stream, options.kind),
        );
      },
    }),
  };
}
