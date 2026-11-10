import assert from "node:assert/strict";
import { test } from "node:test";

import { ownerChange, PaneClaim } from "./pane-claim.ts";
import type { GridSize, TerminalTheme } from "./pane-input.ts";

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

const theme = (foreground: string): TerminalTheme => ({
  foreground,
  background: "101010",
  cursor: foreground,
  ansi: Array.from({ length: 16 }, () => "808080"),
});
const dark = theme("d0d0d0");
const light = theme("202020");

function claim(mayClaim: boolean) {
  const asked: (GridSize | TerminalTheme)[] = [];
  const pane = new PaneClaim({
    mayClaim,
    clientId: US,
    resize: (size) => asked.push(size),
    recolor: (colors) => asked.push(colors),
  });
  return { pane, asked };
}

test("asks for the panel's size and the app's colors in a session the plugin created, once it owns the pane", () => {
  const { pane, asked } = claim(true);
  pane.ownerIs(US);
  pane.wantSize(small);
  pane.wantTheme(dark);
  pane.wantSize(large);
  assert.deepEqual(asked, [small, dark, large]);
});

test("asks for what was wanted before the claim went through", () => {
  const { pane, asked } = claim(true);
  pane.wantSize(small);
  pane.wantTheme(dark);
  assert.deepEqual(asked, []);
  pane.ownerIs(US);
  assert.deepEqual(asked, [small, dark]);
});

test("never asks in a session the plugin did not create", () => {
  const { pane, asked } = claim(false);
  pane.ownerIs(null);
  pane.wantSize(small);
  pane.wantTheme(dark);
  // Not even if Rex were to report this client as the owner.
  pane.ownerIs(US);
  pane.wantSize(large);
  pane.wantTheme(light);
  assert.deepEqual(asked, []);
  assert.equal(pane.mayClaim, false);
});

test("stops asking when another client takes the pane", () => {
  const { pane, asked } = claim(true);
  pane.ownerIs(US);
  pane.wantSize(small);
  pane.ownerIs(THEM);
  pane.wantSize(large);
  pane.wantTheme(light);
  assert.deepEqual(asked, [small]);
});

test("stops asking when the pane is left with no owner", () => {
  const { pane, asked } = claim(true);
  pane.ownerIs(US);
  pane.ownerIs(null);
  pane.wantSize(small);
  pane.wantTheme(dark);
  assert.deepEqual(asked, []);
});

test("asks for the latest size and colors when ownership comes back", () => {
  const { pane, asked } = claim(true);
  pane.ownerIs(US);
  pane.wantSize(small);
  pane.wantTheme(dark);
  pane.ownerIs(THEM);
  pane.wantSize(large);
  pane.wantTheme(light);
  pane.ownerIs(US);
  assert.deepEqual(asked, [small, dark, large, light]);
  // Hearing again that it owns the pane is not a reason to ask again.
  pane.ownerIs(US);
  assert.deepEqual(asked, [small, dark, large, light]);
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
