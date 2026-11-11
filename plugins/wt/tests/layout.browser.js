// Live layout checks for what jsdom cannot show: the host's title bar, compact
// overflow, touch target size, and the compact Select drawer. Panel, removal,
// and settings behavior is covered by the harness tests in this directory.
//
// This script never names a BB instance. Before running it, open the page
// "wt-layout" in the browser session on the instance you mean to check. It is
// read-only: it opens a Select and closes it with Escape, and saves nothing.
const page = await browser.getPage("wt-layout");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
let origin = null;
try {
  const url = new URL(page.url());
  if (url.protocol === "http:" || url.protocol === "https:")
    origin = url.origin;
} catch {
  /* A new page has no URL yet. */
}
assert(
  origin,
  'Open the "wt-layout" page on the BB instance to check first. This script does not choose one.',
);

await page.setViewport({ width: 1440, height: 1000 });
await page.goto(`${origin}/plugins/wt/worktrees`);
await page.waitForSelector('[aria-label="Refresh worktrees"]', {
  timeout: 15000,
});
assert(
  await page.evaluate(
    () =>
      [...document.querySelectorAll("h1, p")].filter(
        (heading) => heading.textContent === "Worktrees",
      ).length === 1,
  ),
  "Worktrees must use the single host title bar",
);

await page.setViewport({ width: 390, height: 844, hasTouch: true });
assert(
  await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  "Compact panel must not overflow horizontally",
);
const actions = await page.$$(
  '[data-wt-row] button[aria-label="Remove worktree"]',
);
if (actions.length === 0) {
  console.log("SKIPPED: touch target size (no worktree rows on this instance)");
} else {
  assert(
    await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-wt-row] button[aria-label="Remove worktree"]',
        ),
      ].every((button) => button.getBoundingClientRect().height >= 36),
    ),
    "Compact trash actions must have touch-sized targets",
  );
}

await page.goto(`${origin}/settings/plugins/wt`);
await page.waitForSelector("#wt-branch-mode", { timeout: 15000 });
await page.click("#wt-branch-mode");
await page.waitForSelector(
  "[data-persistent-drawer-content][data-state=open] [role=option]",
  { visible: true },
);
await page.keyboard.press("Escape");
await page.waitForSelector(
  "[data-persistent-drawer-content][data-state=open]",
  { hidden: true },
);
assert(
  await page.evaluate(() => document.activeElement.id === "wt-branch-mode"),
  "Escape must return focus to the compact Select trigger",
);
console.log(
  "PASS: single host title bar, compact overflow, touch targets, compact Select drawer",
);
