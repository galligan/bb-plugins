import { z } from "zod";
import { idSchema } from "./contracts.ts";
import { RadioError } from "./errors.ts";

export const DISPATCH_BYTES_MAX = 65_536;
const title = z.string().trim().min(1).max(120);
const markdown = z.string().min(1).max(DISPATCH_BYTES_MAX);
const key = z.string().min(1).max(128);
export const createDispatchSchema = z
  .object({
    channelId: idSchema,
    title,
    markdown,
    idempotencyKey: key,
  })
  .strict();
export const reviseDispatchSchema = z
  .object({
    id: idSchema,
    expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    title,
    markdown,
    idempotencyKey: key,
  })
  .strict();
export const readDispatchSchema = z
  .object({
    id: idSchema,
    revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
export const listDispatchSchema = z
  .object({
    channelId: idSchema,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export interface DispatchRevision {
  stationId: string;
  id: string;
  channelId: string;
  authorId: string;
  revision: number;
  title: string;
  markdown: string;
  editorId: string;
  sessionId: string | null;
  createdAt: string;
}

export function parseDispatch<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new RadioError(
      "invalid_input",
      `Invalid dispatch: ${parsed.error.issues[0]!.message}`,
    );
  return parsed.data;
}

export function validateMarkdown(markdown: string) {
  if (
    !markdown.trim() ||
    Buffer.byteLength(markdown, "utf8") > DISPATCH_BYTES_MAX
  )
    throw new RadioError(
      "invalid_input",
      `Dispatch Markdown must contain non-whitespace content and at most ${DISPATCH_BYTES_MAX} UTF-8 bytes; nothing was truncated.`,
    );
}
