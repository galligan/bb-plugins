import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { openRadioStorage } from "./storage.ts";
import { RadioError } from "./errors.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";

export function transmissionFixture(bb: BbPluginApi) {
  const store = openRadioStorage(bb.storage);
  const project = store.projects.register("proj_one", "one").project;
  const other = store.projects.register("proj_other", "other").project;
  const author = store.identities.createActor();
  const session = store.identities.registerThread("thr_sender", author.id);
  const target = store.identities.createActor();
  const human = store.identities.human();
  store.handles.assign(project.id, target.id, "worker", {
    kind: "human",
    actorId: human.id,
  });
  const context: TransmissionContext = {
    authorId: author.id,
    sessionId: session.id,
    caller: { kind: "actor", actorId: author.id },
    scope: { projectIds: [project.id] },
  };
  const input = {
    channelId: project.channelId,
    body: "Ready.",
    idempotencyKey: "one",
  };
  return {
    bb,
    store,
    project,
    other,
    author,
    session,
    target,
    human,
    context,
    input,
  };
}
export function errorCode(expected: string) {
  return (error: unknown) =>
    error instanceof RadioError && error.code === expected;
}
