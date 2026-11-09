import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readCreatedSessions,
  updateCreatedSessions,
} from "./created-sessions.ts";

test("reads a stored list of session IDs", () => {
  assert.deepEqual(readCreatedSessions(["session:1", "session:2"]), [
    "session:1",
    "session:2",
  ]);
});

test("treats anything else in storage as no sessions", () => {
  assert.deepEqual(readCreatedSessions(undefined), []);
  assert.deepEqual(readCreatedSessions(null), []);
  assert.deepEqual(readCreatedSessions("session:1"), []);
  assert.deepEqual(readCreatedSessions({ 0: "session:1" }), []);
  assert.deepEqual(readCreatedSessions(["session:1", 2, null]), ["session:1"]);
});

test("records a session the plugin just created", () => {
  assert.deepEqual(
    updateCreatedSessions(
      ["session:1"],
      ["session:1", "session:9"],
      "session:2",
    ),
    ["session:1", "session:2"],
  );
  assert.deepEqual(updateCreatedSessions([], [], "session:2"), ["session:2"]);
});

test("forgets a recorded session that no longer exists", () => {
  assert.deepEqual(
    updateCreatedSessions(
      ["session:1", "session:2"],
      ["session:2", "session:3"],
    ),
    ["session:2"],
  );
});

test("never adds a session it did not create", () => {
  const live = ["session:main", "session:1"];
  assert.deepEqual(updateCreatedSessions(["session:1"], live), ["session:1"]);
  assert.deepEqual(updateCreatedSessions([], live), []);
});
