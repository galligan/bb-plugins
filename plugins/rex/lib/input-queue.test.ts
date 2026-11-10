import assert from "node:assert/strict";
import { test } from "node:test";

import { InputQueue } from "./input-queue.ts";

/** A backend whose requests finish only when the test says so. */
function backend() {
  const batches: number[][] = [];
  const pending: { finish: () => void; fail: (error: Error) => void }[] = [];
  const failures: unknown[] = [];
  const queue = new InputQueue<number>({
    maxBatch: 3,
    send: (batch) =>
      new Promise<void>((resolve, reject) => {
        batches.push(batch);
        pending.push({ finish: resolve, fail: reject });
      }),
    onFailure: (error) => failures.push(error),
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { queue, batches, pending, failures, settle };
}

test("sends the first input at once", () => {
  const { queue, batches } = backend();
  queue.push(1);
  assert.deepEqual(batches, [[1]]);
});

test("never has two requests in flight", async () => {
  const { queue, batches, pending, settle } = backend();
  queue.push(1);
  queue.push(2);
  queue.push(3);
  assert.deepEqual(batches, [[1]]);
  pending[0]?.finish();
  await settle();
  assert.deepEqual(batches, [[1], [2, 3]]);
});

test("delivers everything in the order it was pushed", async () => {
  const { queue, batches, pending, settle } = backend();
  for (let item = 1; item <= 9; item++) queue.push(item);
  for (let request = 0; request < 4; request++) {
    pending[request]?.finish();
    await settle();
    if (request === 1) queue.push(10);
  }
  assert.deepEqual(batches.flat(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(batches.every((batch) => batch.length <= 3));
});

test("goes quiet when there is nothing left, then starts again", async () => {
  const { queue, batches, pending, settle } = backend();
  queue.push(1);
  pending[0]?.finish();
  await settle();
  queue.push(2);
  assert.deepEqual(batches, [[1], [2]]);
});

test("drops what was waiting when a request fails, and reports it", async () => {
  const { queue, batches, pending, failures, settle } = backend();
  queue.push(1);
  queue.push(2);
  const failure = new Error("gone");
  pending[0]?.fail(failure);
  await settle();
  assert.deepEqual(batches, [[1]]);
  assert.deepEqual(failures, [failure]);

  // Input typed after the failure is sent as usual.
  queue.push(3);
  assert.deepEqual(batches, [[1], [3]]);
});
