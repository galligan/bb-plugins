import assert from "node:assert/strict";
import { test } from "node:test";

import { PaneError } from "./pane-error.ts";
import { socketPathFromEndpoint } from "./rex-socket.ts";

test("decodes the socket path of a unix endpoint", () => {
  assert.equal(
    socketPathFromEndpoint(
      "unix:///Users/someone/Library/Application%20Support/rex/server.sock",
    ),
    "/Users/someone/Library/Application Support/rex/server.sock",
  );
  assert.equal(
    socketPathFromEndpoint("unix:///run/user/1000/rex/server.sock"),
    "/run/user/1000/rex/server.sock",
  );
});

test("refuses an endpoint that is not a Unix socket", () => {
  for (const endpoint of [
    "https://host.example.ts.net",
    "npipe://./pipe/rex",
    "",
  ]) {
    assert.throws(
      () => socketPathFromEndpoint(endpoint),
      (error) => error instanceof PaneError && error.code === "rex_unreachable",
      endpoint,
    );
  }
});
