import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { openRadioStorage } from "./storage.ts";
import { parseBody, type AddressToken } from "./body-parser.ts";
import { resolveAddress } from "./address-resolution.ts";
import { RadioError } from "./errors.ts";

test("resolution is project-local, access-scoped and explicit about ambiguous handles", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radio" });
  try {
    const store = openRadioStorage(bb.storage);
    store.projects.register("proj_one", "one");
    store.projects.register("proj_two", "two");
    const first = store.identities.createActor();
    const second = store.identities.createActor();
    const human = {
      kind: "human" as const,
      actorId: store.identities.human().id,
    };
    store.handles.assign("proj_one", first.id, "worker", human);
    store.handles.assign("proj_two", second.id, "worker", human);
    store.handles.rename("proj_two", second.id, "other", human);
    const token = (text: string) => parseBody(text)[0] as AddressToken;
    const both = { projectIds: ["proj_one", "proj_two"] };
    assert.throws(
      () => resolveAddress(store, token("@worker"), both),
      (error: unknown) =>
        error instanceof RadioError &&
        error.code === "ambiguous" &&
        error.choices.join() === "@one:worker,@two:worker",
    );
    assert.equal(
      resolveAddress(store, token("@worker"), {
        ...both,
        currentProjectId: "proj_one",
      }).targetId,
      first.id,
    );
    assert.equal(
      resolveAddress(store, token("@two:worker"), both).targetId,
      second.id,
    );
    assert.throws(() =>
      resolveAddress(store, token("@other"), {
        ...both,
        currentProjectId: "proj_one",
      }),
    );
    assert.throws(() =>
      resolveAddress(store, token("@two:worker"), { projectIds: ["proj_one"] }),
    );
    assert.throws(() =>
      resolveAddress(store, token("@worker"), {
        projectIds: ["proj_one"],
        currentProjectId: "proj_two",
      }),
    );
    assert.equal(
      resolveAddress(store, token("@user"), both).targetId,
      human.actorId,
    );
    const before = resolveAddress(store, token("@one:worker"), both);
    store.handles.reclaim("proj_one", second.id, "worker", human);
    assert.equal(before.targetId, first.id);
    assert.equal(
      resolveAddress(store, token("@one:worker"), both).targetId,
      second.id,
    );
    store.projects.addSubchannel("proj_one", "release");
    const reference = resolveAddress(store, token("ch:one/release"), both);
    const audience = resolveAddress(store, token("@ch:one/release"), both);
    assert.equal(reference.targetId, audience.targetId);
    assert.equal(reference.token.kind, "channel-reference");
    assert.equal(audience.token.kind, "channel-audience");
    store.projects.rename("proj_one", "renamed");
    assert.equal(
      resolveAddress(store, token("ch:renamed/release"), both).targetId,
      reference.targetId,
    );
  } finally {
    await harness.lifecycle.dispose();
  }
});
