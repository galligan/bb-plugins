import assert from "node:assert/strict";
import { test } from "node:test";

import { PaneError } from "./pane-error.ts";
import { targetCli } from "./target-command.ts";
import type { ThreadWindow } from "./thread-window.ts";

const WINDOW: ThreadWindow = {
  sessionId: "session:1",
  windowId: "window:2",
  blockId: "block:3",
  sessionLabel: "bb",
  windowLabel: "Fix the login redirect [thr_one]",
  own: true,
  clientId: "client:4",
};

/** The command, with a note of the threads it was asked about. */
function command(window: ThreadWindow | Error = WINDOW) {
  const asked: string[] = [];
  const cli = targetCli((threadId) => {
    asked.push(threadId);
    return window instanceof Error
      ? Promise.reject(window)
      : Promise.resolve(window);
  });
  return {
    asked,
    run: (argv: string[], threadId?: string) => cli.run(argv, { threadId }),
  };
}

test("is registered as `bb rex`, with its one command described", () => {
  const cli = targetCli(() => Promise.resolve(WINDOW));
  assert.equal(cli.name, "rex");
  assert.deepEqual(
    cli.commands?.map((entry) => entry.name),
    ["target"],
  );
});

test("reports the terminal of the thread it runs in", async () => {
  const { asked, run } = command();
  const result = await run(["target", "--json"], "thr_one");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(asked, ["thr_one"]);
  assert.deepEqual(JSON.parse(result.stdout ?? ""), {
    ok: true,
    thread: "thr_one",
    session: { id: "session:1", label: "bb" },
    window: {
      id: "window:2",
      label: "Fix the login redirect [thr_one]",
      own: true,
    },
    block: { id: "block:3" },
  });
});

test("takes another thread by flag, over the one it runs in", async () => {
  const { asked, run } = command();
  await run(["target", "--thread", "thr_two"], "thr_one");
  assert.deepEqual(asked, ["thr_two"]);
});

test("prints the IDs with the rex flags that select the pane", async () => {
  const { run } = command();
  const { stdout = "" } = await run(["target"], "thr_one");
  assert.match(stdout, /session {2}session:1 {2}bb/);
  assert.match(
    stdout,
    /window {3}window:2 {2}Fix the login redirect \[thr_one\]/,
  );
  assert.match(stdout, /rex capture -s session:1 -b block:3 --trim/);
  assert.match(stdout, /The window is this thread's own\./);
});

test("says when the window is one the user picked", async () => {
  const { run } = command({ ...WINDOW, own: false });
  const { stdout = "" } = await run(["target"], "thr_one");
  assert.match(stdout, /The user picked this window for the thread/);
  const json = await run(["target", "--json"], "thr_one");
  assert.equal(JSON.parse(json.stdout ?? "").window.own, false);
});

test("fails with a hint when there is no thread to ask about", async () => {
  const { asked, run } = command();
  const result = await run(["target", "--json"]);
  assert.notEqual(result.exitCode, 0);
  assert.deepEqual(asked, []);
  const { ok, error } = JSON.parse(result.stdout ?? "");
  assert.equal(ok, false);
  assert.equal(error.code, "thread_required");
  assert.match(error.hint, /--thread <id>/);
});

test("reports why the terminal could not be found", async () => {
  const { run } = command(
    new PaneError("rex_unreachable", "Could not reach the Rex server."),
  );
  const result = await run(["target", "--json"], "thr_one");
  assert.notEqual(result.exitCode, 0);
  const { error } = JSON.parse(result.stdout ?? "");
  assert.equal(error.code, "rex_unreachable");
  assert.match(result.stderr ?? "", /Could not reach the Rex server/);
});

test("answers --help without looking anything up", async () => {
  const { asked, run } = command();
  const result = await run(["target", "--help"], "thr_one");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(asked, []);
  assert.match(result.stdout ?? "", /--thread/);
});
