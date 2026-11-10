import { z } from "zod";
import type { SourceDefinition } from "../sets-schema.ts";
import {
  SourceFailure,
  sourceValue,
  type SourceSdk,
  type SourceResult,
} from "./contracts.ts";

type Types = NonNullable<
  Parameters<SourceSdk["threads"]["events"]["list"]>[0]["types"]
>;
const eventSchema = z.object({
  seq: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  threadId: z.string(),
  type: z.string(),
  data: z.unknown(),
});
type Event = z.infer<typeof eventSchema>;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

/** Exclusive descending sequence cursors; no unbounded scans or opaque provider-tool guesses. */
async function scan<T>(
  sdk: SourceSdk,
  threadId: string,
  definition: SourceDefinition,
  signal: AbortSignal,
  types: Types,
  count: number,
  project: (row: Event) => T | null,
): Promise<{ row: Event; value: T }[]> {
  const selected: { row: Event; value: T }[] = [];
  let before = definition.beforeSeq;
  for (let page = 0; page < MAX_PAGES; page++) {
    signal.throwIfAborted();
    const rows = z
      .array(eventSchema)
      .max(PAGE_SIZE)
      .parse(
        await sdk.threads.events.list({
          threadId,
          types,
          order: "desc",
          limit: String(PAGE_SIZE),
          ...(before === undefined ? {} : { beforeSeq: String(before) }),
          signal,
        }),
      );
    signal.throwIfAborted();
    for (const row of rows) {
      if (
        row.threadId !== threadId ||
        !types.includes(row.type as Types[number]) ||
        (before !== undefined && row.seq >= before)
      )
        throw new SourceFailure("invalid_history_order");
      before = row.seq;
    }
    for (const row of rows) {
      const value = project(row);
      if (value !== null) selected.push({ row, value });
      if (selected.length === count) return selected;
    }
    if (rows.length < PAGE_SIZE) return selected;
  }
  throw new SourceFailure("history_window_exceeded");
}

const truncationField = z.object({
  originalLength: z.number().nonnegative(),
  retainedHeadLength: z.number().nonnegative(),
  retainedTailLength: z.number().nonnegative(),
  truncatedAt: z.number().nonnegative(),
});
const commandSchema = z.object({
  type: z.literal("commandExecution"),
  command: z.string(),
  status: z.enum(["completed", "failed", "interrupted", "pending"]),
  exitCode: z.number().int().nullable().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
  aggregatedOutput: z.string().optional(),
  truncation: z
    .object({
      aggregatedOutput: truncationField.optional(),
      result: truncationField.optional(),
      resultText: truncationField.optional(),
    })
    .optional(),
});
export async function commands(
  sdk: SourceSdk,
  threadId: string,
  definition: SourceDefinition,
  signal: AbortSignal,
): Promise<SourceResult> {
  const withOutput = definition.from === "thread.commandOutput";
  const selected = await scan(
    sdk,
    threadId,
    definition,
    signal,
    ["item/completed"],
    definition.count ?? 10,
    (row) => {
      const item = z
        .object({ item: z.object({ type: z.string() }).passthrough() })
        .parse(row.data).item;
      if (item.type !== "commandExecution") return null;
      const command = commandSchema.parse(item);
      if (command.status === "pending") return null;
      if (withOutput && command.aggregatedOutput === undefined)
        throw new SourceFailure("command_output_missing");
      return {
        command: command.command,
        exitCode: command.exitCode ?? null,
        durationMs: command.durationMs ?? null,
        status: command.status,
        sequence: row.seq,
        observedAt: row.createdAt,
        ...(withOutput ? { output: command.aggregatedOutput! } : {}),
        truncated:
          command.truncation !== undefined &&
          Object.values(command.truncation).some((v) => v !== undefined),
      };
    },
  );
  if (!selected.length) throw new SourceFailure("command_evidence_missing");
  return sourceValue(
    selected.map((entry) => entry.value).reverse(),
    definition,
    true,
    {
      sequence: selected[0]!.row.seq,
      selection: {
        maxChars: definition.maxChars,
        count: selected.length,
        truncated: selected.some((entry) => entry.value.truncated),
      },
    },
  );
}

const requestSchema = z.object({
  initiator: z.enum(["user", "agent", "system"]),
  senderThreadId: z.string().nullable(),
  originPluginId: z.string().nullable().optional(),
  systemMessageKind: z.string().optional(),
  retryOfRequestId: z.string().optional(),
  input: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
      visibility: z.string().optional(),
    }),
  ),
  inputGroups: z.array(z.unknown()).optional(),
});
export async function recentUsers(
  sdk: SourceSdk,
  threadId: string,
  definition: SourceDefinition,
  signal: AbortSignal,
): Promise<SourceResult> {
  const selected = await scan(
    sdk,
    threadId,
    definition,
    signal,
    ["client/turn/requested"],
    definition.count ?? 5,
    (row) => {
      const request = requestSchema.parse(row.data);
      if (
        request.initiator !== "user" ||
        request.senderThreadId !== null ||
        request.originPluginId != null ||
        request.systemMessageKind !== undefined ||
        request.retryOfRequestId !== undefined
      )
        return null;
      if ((request.inputGroups?.length ?? 0) > 1)
        throw new SourceFailure("history_mixed_groups");
      const visible = request.input.filter(
        (part) => part.visibility !== "agent-only",
      );
      if (
        visible.some((part) => part.type !== "text" || part.text === undefined)
      )
        throw new SourceFailure("history_content_unsupported");
      if (!visible.length) return null;
      return {
        text: visible.map((part) => part.text!).join("\n"),
        sequence: row.seq,
        observedAt: row.createdAt,
      };
    },
  );
  if (!selected.length) throw new SourceFailure("user_evidence_missing");
  return sourceValue(
    selected.map((entry) => entry.value).reverse(),
    definition,
    true,
    {
      sequence: selected[0]!.row.seq,
      selection: { maxChars: definition.maxChars, count: selected.length },
    },
  );
}

const goalSchema = z.object({
  objective: z.string(),
  status: z.enum([
    "active",
    "blocked",
    "budgetLimited",
    "complete",
    "paused",
    "usageLimited",
  ]),
  tokenBudget: z.number().nonnegative().nullable(),
  tokensUsed: z.number().nonnegative(),
  timeUsedSeconds: z.number().nonnegative(),
});
export async function goal(
  sdk: SourceSdk,
  threadId: string,
  definition: SourceDefinition,
  signal: AbortSignal,
): Promise<SourceResult> {
  const selected = await scan(
    sdk,
    threadId,
    definition,
    signal,
    ["thread/goal/updated", "thread/goal/cleared"],
    1,
    (row) => {
      if (row.type === "thread/goal/cleared")
        throw new SourceFailure("goal_cleared");
      return goalSchema.parse(row.data);
    },
  );
  if (!selected.length) throw new SourceFailure("goal_evidence_missing");
  return sourceValue(selected[0]!.value, definition, true, {
    sequence: selected[0]!.row.seq,
    selection: { maxChars: definition.maxChars, count: 1 },
  });
}
