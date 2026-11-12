import { createHash } from "node:crypto";
import { z } from "zod";
import type { SetupStore } from "../setup/storage.ts";
import { captureKind, type Creation } from "./contracts.ts";
import { captureStreamId } from "./origins.ts";

const progressSchema = z.strictObject({
  streamId: captureStreamId,
  kind: captureKind,
  through: z.number().int().positive(),
  recordId: z.string(),
});
export function captureProgress(store: SetupStore) {
  function name(stream: string, kind: string) {
    return `CAPTURE:${createHash("sha256")
      .update(JSON.stringify([stream, kind]))
      .digest("hex")}.json`;
  }
  function read(
    botId: string,
    streamId: string,
    kind: z.infer<typeof captureKind>,
  ) {
    store.get(botId);
    streamId = captureStreamId.parse(streamId);
    kind = captureKind.parse(kind);
    const doc = store.documents.get(botId, name(streamId, kind));
    const found = doc ? progressSchema.parse(JSON.parse(doc.markdown)) : null;
    if (found && (found.streamId !== streamId || found.kind !== kind))
      throw new Error("Capture progress identity does not match its stream.");
    return {
      revision: doc?.revision ?? 0,
      through: found?.through ?? 0,
      recordId: found?.recordId ?? null,
    };
  }
  return {
    read,
    advance(input: Exclude<Creation, { kind: "knowledge" }>, recordId: string) {
      const { boundary, kind, botId } = input;
      const current = read(botId, boundary.streamId, kind);
      if (
        current.revision !== boundary.expectedRevision ||
        boundary.from !== current.through + 1
      )
        throw new Error(
          "Capture boundary changed or skips unprocessed input. Read progress first.",
        );
      store.documents.write({
        botId,
        name: name(boundary.streamId, kind),
        expectedRevision: current.revision,
        markdown: JSON.stringify({
          streamId: boundary.streamId,
          kind,
          through: boundary.through,
          recordId,
        }),
        author: input.author,
        reason: input.reason,
      });
      return read(botId, boundary.streamId, kind);
    },
  };
}
