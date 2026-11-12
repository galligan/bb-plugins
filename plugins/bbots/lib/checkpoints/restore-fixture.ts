import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { fixture as memoryFixture } from "../memory/fixture.test.ts";
import { openSoul } from "../soul/store.ts";
import { openCheckpoints } from "./store.ts";
import { createRestore } from "./restore.ts";
import { restoreSchema, type RestoreInput } from "./restore-contracts.ts";

export const attribution = {
  author: "fixture-user",
  reason: "Explicit selected restore",
};
export function fixture(t: TestContext) {
  const f = memoryFixture(t),
    soul = openSoul(f.bb.storage, f.setup, () => {});
  const checkpoints = openCheckpoints(f.bb.storage, f.setup, soul);
  const lifecycle = new AbortController();
  const restore = createRestore(
    f.bb,
    f.setup,
    checkpoints,
    f.memory,
    lifecycle.signal,
    () => {},
  );
  function checkpoint() {
    return checkpoints.create({
      botId: f.bot.botId,
      name: "Before edits",
      requestId: randomUUID(),
      ...attribution,
    }).checkpoint.id;
  }
  function request(id: string, selection: RestoreInput["selection"]) {
    return restoreSchema.parse({
      botId: f.bot.botId,
      checkpointId: id,
      requestId: randomUUID(),
      selection,
      ...attribution,
    });
  }
  return { ...f, soul, checkpoints, checkpoint, request, restore, lifecycle };
}
