import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { transmissionFixture } from "./transmission-fixture.ts";
export function attentionFixture(bb: BbPluginApi) {
  const f = transmissionFixture(bb);
  const worker = f.store.identities.registerThread("thr_worker", f.target.id);
  const workerContext = {
    ...f.context,
    authorId: f.target.id,
    sessionId: worker.id,
    caller: { kind: "actor" as const, actorId: f.target.id },
  };
  return { ...f, worker, workerContext };
}
