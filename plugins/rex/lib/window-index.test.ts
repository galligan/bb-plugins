import assert from "node:assert/strict";
import { test } from "node:test";

import { retryUntilDone, ThreadWindowIndex } from "./window-index.ts";

/** Stored records, in memory. */
function storage(threads: string[]) {
  const records = new Set(threads);
  return {
    records,
    list: () => Promise.resolve([...records]),
    has: (threadId: string) => Promise.resolve(records.has(threadId)),
  };
}

test("knows the threads it is told about", () => {
  const index = new ThreadWindowIndex();
  assert.equal(index.has("thr_one"), false);
  index.add("thr_one");
  assert.equal(index.has("thr_one"), true);
  index.delete("thr_one");
  assert.equal(index.has("thr_one"), false);
});

test("loads the threads that have a stored record", async () => {
  const index = new ThreadWindowIndex();
  await index.load(storage(["thr_one", "thr_two"]));
  assert.deepEqual(index.threads().sort(), ["thr_one", "thr_two"]);
});

test("does not bring back a thread whose record went while it was loading", async () => {
  const index = new ThreadWindowIndex();
  const stored = storage(["thr_one", "thr_two"]);
  await index.load({
    list: stored.list,
    has: (threadId) => {
      // An archive closes thr_two's window while thr_one is being checked.
      if (threadId === "thr_one") {
        stored.records.delete("thr_two");
        index.delete("thr_two");
      }
      return stored.has(threadId);
    },
  });
  assert.deepEqual(index.threads(), ["thr_one"]);
});

test("stays usable when storage cannot be read, and loads on a later try", async () => {
  const index = new ThreadWindowIndex();
  index.add("thr_new");
  await assert.rejects(
    index.load({
      list: () => Promise.reject(new Error("storage is unavailable")),
      has: () => Promise.resolve(false),
    }),
    /storage is unavailable/,
  );
  assert.deepEqual(index.threads(), ["thr_new"]);

  await index.load(storage(["thr_one"]));
  assert.deepEqual(index.threads().sort(), ["thr_new", "thr_one"]);
});

test("hands out a list that later changes do not alter", () => {
  const index = new ThreadWindowIndex();
  index.add("thr_one");
  const threads = index.threads();
  index.delete("thr_one");
  assert.deepEqual(threads, ["thr_one"]);
});

/** Lets promise callbacks that are already due run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("tries again each time an attempt fails, and stops once one succeeds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  retryUntilDone(() => {
    attempts += 1;
    return attempts < 3
      ? Promise.reject(new Error("not yet"))
      : Promise.resolve();
  }, 1000);

  assert.equal(attempts, 0, "the first attempt waits its turn too");
  for (const expected of [1, 2, 3, 3, 3]) {
    t.mock.timers.tick(1000);
    await settle();
    assert.equal(attempts, expected);
  }
});

test("schedules nothing more once stopped, even by an attempt under way", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  let fail = () => {};
  const stop = retryUntilDone(() => {
    attempts += 1;
    return new Promise<void>((_, reject) => {
      fail = () => reject(new Error("storage is unavailable"));
    });
  }, 1000);

  t.mock.timers.tick(1000);
  assert.equal(attempts, 1);
  // The plugin is disposed while that attempt is still reading.
  stop();
  fail();
  await settle();
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(attempts, 1);
});

test("stops before the first attempt when stopped at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let attempts = 0;
  const stop = retryUntilDone(() => {
    attempts += 1;
    return Promise.resolve();
  }, 1000);
  stop();
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(attempts, 0);
});
