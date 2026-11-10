import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { transmissionFixture } from "./transmission-fixture.ts";
export function commitmentFixture(bb: BbPluginApi) {
  const f = transmissionFixture(bb);
  const worker = f.store.identities.registerThread("thr_worker", f.target.id);
  const workerContext = {
    ...f.context,
    authorId: f.target.id,
    sessionId: worker.id,
    caller: { kind: "actor" as const, actorId: f.target.id },
  };
  const tx = f.store.transmissions.send(f.context, {
    ...f.input,
    recipientIds: [f.target.id],
    requireAck: true,
    expectReply: true,
  }).transmission;
  const wilco = {
    kind: "wilco" as const,
    txId: tx.id,
    targetId: f.target.id,
    idempotencyKey: "accept",
  };
  return { ...f, worker, workerContext, tx, wilco };
}
