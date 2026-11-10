import assert from "node:assert/strict";
import { test } from "node:test";

import { threadWindowLabel } from "./window-label.ts";

const ID = "thr_9m77ycc67i";
const size = (text: string) => Buffer.byteLength(text, "utf8");

test("puts the thread's ID after its title", () => {
  assert.equal(
    threadWindowLabel("Fix the login redirect", ID),
    `Fix the login redirect [${ID}]`,
  );
});

test("names a thread that has no title yet", () => {
  assert.equal(threadWindowLabel(null, ID), `Thread [${ID}]`);
  assert.equal(threadWindowLabel("  \n ", ID), `Thread [${ID}]`);
});

test("shortens a long title and never the ID", () => {
  const label = threadWindowLabel("word ".repeat(60), ID);
  assert.ok(size(label) <= 128, `${size(label)} bytes`);
  assert.ok(label.endsWith(`… [${ID}]`), label);
  assert.ok(label.startsWith("word word word"), label);
  assert.ok(size(label) > 120, "uses the room there is");
});

test("leaves a title that just fits alone", () => {
  const title = "x".repeat(128 - ` [${ID}]`.length);
  assert.equal(threadWindowLabel(title, ID), `${title} [${ID}]`);
  assert.ok(threadWindowLabel(`${title}x`, ID).includes("…"));
});

test("turns line breaks and other control characters into spaces", () => {
  assert.equal(
    threadWindowLabel("# Build a pane\n\n## Goal\tfirst\x07 slice\x1b[0m", ID),
    `# Build a pane ## Goal first slice [0m [${ID}]`,
  );
});

test("counts the limit in bytes and keeps whole characters", () => {
  const label = threadWindowLabel("語".repeat(80), ID);
  assert.ok(size(label) <= 128, `${size(label)} bytes`);
  assert.ok(label.endsWith(`… [${ID}]`));
  assert.match(label, /^語+… \[/u);

  const emoji = threadWindowLabel("👍🏽".repeat(40), ID);
  assert.ok(size(emoji) <= 128);
  assert.equal(emoji.includes("�"), false);
  assert.equal(Buffer.from(emoji, "utf8").toString("utf8"), emoji);
});
