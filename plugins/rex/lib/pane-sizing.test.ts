import assert from "node:assert/strict";
import { test } from "node:test";

import type { GridSize } from "./pane-input.ts";
import { ownerChange, PaneSizing } from "./pane-sizing.ts";

const US = "client:us";
const THEM = "client:them";
const small: GridSize = {
  cols: 60,
  rows: 20,
  cellWidthPx: 7,
  cellHeightPx: 16,
};
const large: GridSize = {
  cols: 120,
  rows: 40,
  cellWidthPx: 7,
  cellHeightPx: 16,
};

function sizing(mayClaim: boolean) {
  const requested: GridSize[] = [];
  const pane = new PaneSizing({
    mayClaim,
    clientId: US,
    request: (size) => requested.push(size),
  });
  return { pane, requested };
}

test("asks for the panel's size in a session the plugin created, once it owns the pane", () => {
  const { pane, requested } = sizing(true);
  pane.ownerIs(US);
  pane.want(small);
  pane.want(large);
  assert.deepEqual(requested, [small, large]);
});

test("asks for a size wanted before the claim went through", () => {
  const { pane, requested } = sizing(true);
  pane.want(small);
  assert.deepEqual(requested, []);
  pane.ownerIs(US);
  assert.deepEqual(requested, [small]);
});

test("never asks in a session the plugin did not create", () => {
  const { pane, requested } = sizing(false);
  pane.ownerIs(null);
  pane.want(small);
  // Not even if Rex were to report this client as the owner.
  pane.ownerIs(US);
  pane.want(large);
  assert.deepEqual(requested, []);
  assert.equal(pane.mayClaim, false);
});

test("stops asking when another client takes the pane", () => {
  const { pane, requested } = sizing(true);
  pane.ownerIs(US);
  pane.want(small);
  pane.ownerIs(THEM);
  pane.want(large);
  assert.deepEqual(requested, [small]);
});

test("stops asking when the pane is left with no owner", () => {
  const { pane, requested } = sizing(true);
  pane.ownerIs(US);
  pane.ownerIs(null);
  pane.want(small);
  assert.deepEqual(requested, []);
});

test("asks for the latest wanted size when ownership comes back", () => {
  const { pane, requested } = sizing(true);
  pane.ownerIs(US);
  pane.want(small);
  pane.ownerIs(THEM);
  pane.want(large);
  pane.ownerIs(US);
  assert.deepEqual(requested, [small, large]);
  // Hearing again that it owns the pane is not a reason to ask again.
  pane.ownerIs(US);
  assert.deepEqual(requested, [small, large]);
});

const pane = { sessionId: "session:1", blockId: "block:1" };

function ownerEvent(blockId: string, owner?: string, sessionId = "session:1") {
  return {
    type: "event",
    seq: 4,
    payload: {
      type: "session_event",
      payload: {
        session_id: sessionId,
        event: {
          type: "block_owner_changed",
          payload: { block_id: blockId, owner, previous: US, reason: "take" },
        },
      },
    },
  };
}

test("reads the new owner of the pane from a control event", () => {
  assert.equal(ownerChange(ownerEvent("block:1", THEM), pane), THEM);
  assert.equal(ownerChange(ownerEvent("block:1"), pane), null);
});

test("ignores owner changes for other blocks and sessions", () => {
  assert.equal(ownerChange(ownerEvent("block:2", THEM), pane), undefined);
  assert.equal(
    ownerChange(ownerEvent("block:1", THEM, "session:2"), pane),
    undefined,
  );
});

test("ignores every other control message", () => {
  assert.equal(
    ownerChange({ type: "response", id: "1", seq: 0 }, pane),
    undefined,
  );
  assert.equal(ownerChange(null, pane), undefined);
  assert.equal(
    ownerChange(
      {
        type: "event",
        seq: 1,
        payload: {
          type: "session_event",
          payload: {
            session_id: "session:1",
            event: { type: "block_closed", payload: { block_id: "block:1" } },
          },
        },
      },
      pane,
    ),
    undefined,
  );
});
