// Tests the live script's control flow, not browser layout or touch emulation.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test, vi } from "vitest";

const script = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "layout.browser.js"),
  "utf8",
);
const runScript = new Function(
  "browser",
  "console",
  `return (async () => {${script}})()`,
);

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function run({
  empty = false,
  coarse = true,
  height = 36,
  rescues = false,
} = {}) {
  const messages: string[] = [];
  let loaded = false;
  let loadingWaits = 0;
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("matchMedia", () => ({ matches: coarse }));
  const page = {
    url: () => "https://isolated.invalid/plugins/wt/worktrees",
    setViewport: async ({ hasTouch }: { hasTouch?: boolean }) => {
      if (hasTouch) {
        loaded = false;
        document.body.innerHTML =
          "<p>Worktrees</p><main>Loading worktrees…</main>";
      }
    },
    goto: async (url: string) => {
      if (url.endsWith("/worktrees")) {
        document.body.innerHTML =
          "<p>Worktrees</p><main>Loading worktrees…</main>";
      } else {
        document.body.innerHTML =
          '<button id="wt-branch-mode">Branch naming</button>';
      }
    },
    waitForSelector: async () => {},
    waitForFunction: async (predicate: () => boolean) => {
      if (predicate()) return;
      loadingWaits++;
      document.querySelector("main")!.innerHTML = empty
        ? `No Worktree+ worktrees.${rescues ? '<section data-wt-project="rescues:fixture:host">Saved rescue</section>' : ""}`
        : '<section data-wt-project><div data-wt-row><button aria-label="Remove worktree"></button></div></section>';
      const button = document.querySelector("[data-wt-row] button");
      if (button) {
        vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
          height,
        } as DOMRect);
      }
      expect(predicate()).toBe(true);
      loaded = true;
    },
    evaluate: async (fn: () => unknown) => fn(),
    $$: async (selector: string) => {
      expect(loaded, "must wait for overview before inspecting rows").toBe(
        true,
      );
      return Array.from(document.querySelectorAll(selector));
    },
    click: async () => {},
    keyboard: {
      press: async () =>
        document.querySelector<HTMLElement>("#wt-branch-mode")!.focus(),
    },
  };
  await runScript(
    { getPage: async () => page },
    { log: (value: string) => messages.push(value) },
  );
  expect(loadingWaits, "waits for initial load and viewport reload").toBe(2);
  return messages;
}

test("delayed populated overview is measured rather than skipped", async () => {
  expect(await run()).toEqual([
    expect.stringContaining("touch targets passed"),
  ]);
});

test("an explicit empty overview reports skipped touch coverage", async () => {
  const messages = await run({ empty: true });
  expect(messages.at(-1)).toContain("touch targets skipped (no worktrees)");
  expect(messages.join("\n")).not.toContain("touch targets passed");
});

test("a narrow fine-pointer viewport cannot pass touch coverage", async () => {
  await expect(run({ coarse: false })).rejects.toThrow(
    "coarse-pointer emulation",
  );
});

test("undersized targets in the delayed overview fail", async () => {
  await expect(run({ height: 28 })).rejects.toThrow("touch-sized targets");
});

test("rescue-only sections do not count as worktrees", async () => {
  const messages = await run({ empty: true, rescues: true, coarse: false });
  expect(messages.at(-1)).toContain("touch targets skipped (no worktrees)");
});
