import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chooseSession,
  chooseWindowPane,
  sessionViewSchema,
  type SessionView,
} from "./session.ts";

const sessions = [
  { session_id: "session:1", label: "main" },
  { session_id: "session:2", label: "bb" },
  { session_id: "session:3", label: "twin" },
  { session_id: "session:4", label: "twin" },
];

test("finds the one session with the label", () => {
  assert.deepEqual(chooseSession({ sessions }, "bb"), {
    kind: "found",
    sessionId: "session:2",
  });
});

test("reports a label no session has", () => {
  assert.deepEqual(chooseSession({ sessions }, "absent"), { kind: "missing" });
  assert.deepEqual(chooseSession({ sessions: null }, "bb"), {
    kind: "missing",
  });
});

test("matches the whole label, with its case", () => {
  assert.deepEqual(chooseSession({ sessions }, "BB"), { kind: "missing" });
  assert.deepEqual(chooseSession({ sessions }, "b"), { kind: "missing" });
});

test("does not pick between sessions that share the label", () => {
  assert.deepEqual(chooseSession({ sessions }, "twin"), {
    kind: "ambiguous",
    count: 2,
  });
});

const terminal = (id: string) => ({
  block_id: id,
  creator_name: "com.superlogical.terminal",
});

function view(overrides: Partial<SessionView> = {}): SessionView {
  return {
    active_window_id: "window:b",
    windows: [
      {
        window_id: "window:a",
        focused_block_id: "block:a1",
        layers: [{ blocks: [terminal("block:a1")] }],
      },
      {
        window_id: "window:b",
        focused_block_id: "block:b2",
        layers: [
          { blocks: [terminal("block:b1")] },
          { blocks: [terminal("block:b2")] },
        ],
      },
    ],
    ...overrides,
  };
}

test("takes the focused block of the window asked for, on any layer", () => {
  assert.deepEqual(chooseWindowPane(view(), "window:b"), {
    kind: "terminal",
    blockId: "block:b2",
  });
  // Not the active window's: the one named.
  assert.deepEqual(chooseWindowPane(view(), "window:a"), {
    kind: "terminal",
    blockId: "block:a1",
  });
});

test("reports a window that is not in the session", () => {
  assert.deepEqual(chooseWindowPane(view(), "window:gone"), {
    kind: "none",
    reason: "The window is no longer there.",
  });
  assert.equal(chooseWindowPane({}, "window:a").kind, "none");
});

test("reports a window with nothing focused", () => {
  const choice = chooseWindowPane(
    view({ windows: [{ window_id: "window:c", layers: [{ blocks: null }] }] }),
    "window:c",
  );
  assert.deepEqual(choice, {
    kind: "none",
    reason: "The window has no focused pane.",
  });
});

test("does not offer a focused block that is not a terminal", () => {
  const choice = chooseWindowPane(
    view({
      windows: [
        {
          window_id: "window:c",
          focused_block_id: "block:c1",
          layers: [
            {
              blocks: [
                {
                  block_id: "block:c1",
                  creator_name: "com.superlogical.onboarding",
                },
              ],
            },
          ],
        },
      ],
    }),
    "window:c",
  );
  assert.deepEqual(choice, {
    kind: "none",
    reason: "The focused pane is not a terminal.",
  });
});

test("reads the view from the Rex API page's example", () => {
  const parsed = sessionViewSchema.parse({
    revision: 3,
    session_id: "session:<uuid>",
    label: "work",
    active_window_id: "window:<uuid>",
    windows: [
      {
        window_id: "window:<uuid>",
        label: "editor",
        focused_block_id: "block:<uuid>",
        layers: [
          {
            layer_id: "layer:<uuid>",
            kind: "tiled",
            bounds: [0, 0, 1, 1],
            layout: { rect: [0, 0, 1, 1], block_id: "block:<uuid>" },
            blocks: [
              {
                block_id: "block:<uuid>",
                label: "shell",
                creator_name: "com.superlogical.terminal",
                flavor: "com.superlogical.terminal.shell",
                host_id: "0e9d6c1f-4a3b-4a52-9c85-2f6d3f6f2f10",
              },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(chooseWindowPane(parsed, "window:<uuid>"), {
    kind: "terminal",
    blockId: "block:<uuid>",
  });
  assert.equal(parsed.windows?.[0]?.label, "editor");
});
