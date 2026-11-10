import assert from "node:assert/strict";
import { test } from "node:test";

import { FakeRex } from "./fake-rex.ts";
import { listWindows, windowsFrom } from "./rex-directory.ts";

test("lists every session's windows and panes, in Rex's order", async () => {
  const rex = new FakeRex();
  const main = rex.addSession("main", ["editor", "server"]);
  const other = rex.addSession("other", ["only"]);
  const server = main.windows[1];
  assert.ok(server !== undefined);
  const logs = rex.split(server, "logs");

  assert.deepEqual(await listWindows(rex), [
    {
      sessionId: main.id,
      label: "main",
      windows: [
        {
          windowId: main.windows[0]?.id,
          label: "editor",
          panes: [{ blockId: main.windows[0]?.blocks[0]?.id, label: "shell" }],
        },
        {
          windowId: server.id,
          label: "server",
          panes: [
            { blockId: server.blocks[0]?.id, label: "shell" },
            { blockId: logs.id, label: "logs" },
          ],
        },
      ],
    },
    {
      sessionId: other.id,
      label: "other",
      windows: [
        {
          windowId: other.windows[0]?.id,
          label: "only",
          panes: [{ blockId: other.windows[0]?.blocks[0]?.id, label: "shell" }],
        },
      ],
    },
  ]);
});

test("attaches to no session to do it", async () => {
  const rex = new FakeRex();
  rex.addSession("main");
  rex.addSession("bots");
  await listWindows(rex);
  assert.deepEqual(rex.methods, [
    "session.list",
    "target.complete",
    "target.complete",
  ]);
});

test("lists a session with no windows, and a server with no sessions", async () => {
  const rex = new FakeRex();
  assert.deepEqual(await listWindows(rex), []);
  const empty = rex.addSession("empty", []);
  assert.deepEqual(await listWindows(rex), [
    { sessionId: empty.id, label: "empty", windows: [] },
  ]);
});

test("counts a window once however many ways it is named", () => {
  const target = {
    kind: "window",
    window_id: "window:1",
    label: "editor",
    ordinal: 1,
  };
  const windows = windowsFrom({
    completions: [
      { form: "label", target },
      { form: "ordinal", target },
      { form: "id", target },
    ],
  });
  assert.deepEqual(windows, [
    { windowId: "window:1", label: "editor", panes: [] },
  ]);
  assert.deepEqual(windowsFrom({ completions: null }), []);
});

test("leaves out a detached block and a kind it does not know", () => {
  const windows = windowsFrom({
    completions: [
      {
        form: "id",
        target: { kind: "window", window_id: "window:1", label: "w" },
      },
      {
        form: "id",
        target: { kind: "block", block_id: "block:9", label: "x" },
      },
      {
        form: "id",
        target: { kind: "layer", window_id: "window:1", label: "" },
      },
    ],
  });
  assert.deepEqual(windows, [{ windowId: "window:1", label: "w", panes: [] }]);
});
