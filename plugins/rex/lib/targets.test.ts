import assert from "node:assert/strict";
import { test } from "node:test";

import { setTargetSchema, targetExists } from "./targets.ts";

const sessions = [
  {
    sessionId: "session:1",
    label: "main",
    windows: [
      {
        windowId: "window:1",
        label: "editor",
        panes: [
          { blockId: "block:1", label: "shell" },
          { blockId: "block:2", label: "logs" },
        ],
      },
    ],
  },
];
const target = (overrides: object = {}) => ({
  sessionId: "session:1",
  windowId: "window:1",
  blockId: null,
  ...overrides,
});

test("accepts a window that is listed, with or without one of its panes", () => {
  assert.equal(targetExists(sessions, target()), true);
  assert.equal(targetExists(sessions, target({ blockId: "block:2" })), true);
});

test("refuses a window, session or pane that is not listed", () => {
  assert.equal(targetExists(sessions, target({ windowId: "window:9" })), false);
  assert.equal(
    targetExists(sessions, target({ sessionId: "session:9" })),
    false,
  );
  assert.equal(targetExists(sessions, target({ blockId: "block:9" })), false);
  assert.equal(targetExists([], target()), false);
});

test("reads a change of pick, and a return to the thread's own window", () => {
  assert.equal(
    setTargetSchema.safeParse({ thread: "thr_1", target: target() }).success,
    true,
  );
  assert.equal(
    setTargetSchema.safeParse({ thread: "thr_1", target: null }).success,
    true,
  );
});

test("refuses a change of pick that is not in shape", () => {
  for (const body of [
    null,
    {},
    { thread: "", target: null },
    { thread: "thr_1" },
    { thread: "thr_1", target: { sessionId: "session:1" } },
    { thread: "thr_1", target: target({ windowId: "" }) },
    { thread: "thr_1", target: target({ blockId: 4 }) },
  ]) {
    assert.equal(setTargetSchema.safeParse(body).success, false);
  }
});
