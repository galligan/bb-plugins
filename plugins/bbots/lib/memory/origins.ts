import { z } from "zod";

export const sourceId = z
  .string()
  .trim()
  .max(256)
  .regex(
    /^(thread|artifact|task|user):\S+$/,
    "Use an original thread/artifact/task/user source identifier without spaces",
  );
export const captureStreamId = sourceId.refine(
  (value) => !/^thread:[^#]+#msg=\d+$/.test(value),
  "Use the whole thread as the capture stream; cite individual messages as sources",
);
export const windowSchema = z
  .strictObject({
    streamId: captureStreamId,
    from: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    through: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .refine(
    (value) => value.through >= value.from,
    "Source window cannot run backwards",
  );
export const originSchema = z.union([sourceId, windowSchema]);
export type Origin = z.infer<typeof originSchema>;
const prefix = "bbots-range:";

export function originKey(origin: Origin): string {
  if (typeof origin === "string") {
    const source = sourceId.parse(origin);
    const message = /^(thread:[^#]+)#msg=(\d+)$/.exec(source);
    if (!message) return source;
    return originKey({
      streamId: message[1]!,
      from: Number(message[2]),
      through: Number(message[2]),
    });
  }
  return prefix + JSON.stringify(windowSchema.parse(origin));
}
export function originFromKey(key: string): Origin {
  return key.startsWith(prefix)
    ? windowSchema.parse(JSON.parse(key.slice(prefix.length)))
    : sourceId.parse(key);
}

// Exact origins, whole-stream origins and overlapping windows share exclusion.
// CASE keeps ordinary identifier strings out of SQLite's JSON parser.
export function originMatchesSql(a: string, b: string) {
  const json = (value: string) =>
    `CASE WHEN substr(${value},1,12)='bbots-range:' THEN substr(${value},13) ELSE 'null' END`;
  const field = (value: string, name: string) =>
    `json_extract((${json(value)}),'$.${name}')`;
  const streamA = field(a, "streamId"),
    streamB = field(b, "streamId");
  return `(${a}=${b} OR ${streamA}=${b} OR ${streamB}=${a} OR
    (${streamA}=${streamB} AND ${field(a, "from")}<=${field(b, "through")}
      AND ${field(b, "from")}<=${field(a, "through")}))`;
}
