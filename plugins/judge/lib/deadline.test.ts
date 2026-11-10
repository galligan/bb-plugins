import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { Deadline, OperationAborted } from "./deadline.ts";

test("deadline completion removes caller listeners and does not abort completed work", async () => {
  const caller = new AbortController();
  const scope = new Deadline({
    signals: [caller.signal],
    deadlineAt: performance.now() + 1000,
    timeoutMs: 500,
  });
  assert.equal(getEventListeners(caller.signal, "abort").length, 1);
  assert.equal(await scope.run(async () => "done"), "done");
  assert.equal(getEventListeners(scope.signal, "abort").length, 0);
  scope.close();
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  caller.abort();
  assert.equal(scope.signal.aborted, false);
});

test("caller cancellation wins immediately and only typed cancellation reasons escape", async () => {
  const caller = new AbortController();
  caller.abort("secret-shaped reason");
  const scope = new Deadline({
    signals: [caller.signal],
    deadlineAt: performance.now() + 1000,
  });
  await assert.rejects(
    scope.run(async () => "must not run"),
    (error: unknown) =>
      error instanceof OperationAborted &&
      error.reason === "cancelled" &&
      !error.message.includes("secret"),
  );
  scope.close();
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
  assert.throws(
    () => new Deadline({ deadlineAt: Infinity }),
    /invalid_deadline/,
  );
});
