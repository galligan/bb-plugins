// Read-only UI checks against the local app; only browser collapse preferences change.
const page = await browser.getPage("tidy-regression");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
await page.setViewport({ width: 1440, height: 1000 });
await page.goto("http://127.0.0.1:38886/plugins/wt/worktrees");
await page.waitForSelector("main li", { timeout: 15000 });
assert(
  await page.evaluate(() => !!document.querySelector("[data-wt-project]")),
  "Projects must use collapsible containers",
);

const key = await page.evaluate(
  () =>
    document.querySelector('[data-wt-project][data-attention="0"]').dataset
      .wtProject,
);
const selector = `[data-wt-project="${key}"] > button`;
const saved = await page.evaluate(
  (key) => localStorage.getItem(`wt:collapsed:${key}`),
  key,
);
try {
  await page.click(selector);
  await page.goto("http://127.0.0.1:38886/plugins/wt/worktrees");
  await page.waitForSelector(selector);
  assert(
    await page.evaluate(
      (selector) =>
        document.querySelector(selector).getAttribute("aria-expanded") ===
        "false",
      selector,
    ),
    "Collapsed project must survive reload",
  );
  await page.focus(selector);
  await page.keyboard.press("Enter");
  await page.waitForSelector("[data-wt-row]");
  assert(
    await page.evaluate(
      (selector) =>
        document.querySelector(selector).getAttribute("aria-expanded") ===
        "true",
      selector,
    ),
    "Keyboard must expand a project",
  );
  assert(
    await page.evaluate(
      () =>
        ![...document.querySelectorAll("[data-wt-title]")].some((line) =>
          /\bSAFE\b|In use/.test(line.textContent),
        ),
    ),
    "Normal rows must not show SAFE or In use badges",
  );
  assert(
    await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[data-wt-row] button[aria-label="Remove worktree"]',
        ),
      ].every(
        (button) =>
          button.querySelector('[data-icon="Trash2"]') &&
          !button.className.includes("bg-destructive"),
      ),
    ),
    "Removal must use a ghost trash action",
  );
  const more = await page.$('button[aria-label$="more threads"]');
  if (more) {
    await more.click();
    await page.waitForSelector(
      '[data-bb-plugin="wt"][role="dialog"][data-state="open"]',
      { visible: true },
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() =>
      document.activeElement
        ?.getAttribute("aria-label")
        ?.endsWith("more threads"),
    );
    assert(
      await more.evaluate((element) => document.activeElement === element),
      "Thread popover must return focus",
    );
  }
  await page.setViewport({ width: 390, height: 844, hasTouch: true });
  await page.waitForSelector("[data-wt-row]");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Compact panel must not overflow horizontally",
  );
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
  console.log(
    "PASS: collapsible project persistence/keyboard, quiet rows, ghost trash actions, thread popover focus, compact layout",
  );
} finally {
  await page.evaluate(
    ({ key, saved }) => {
      if (saved === null) localStorage.removeItem(`wt:collapsed:${key}`);
      else localStorage.setItem(`wt:collapsed:${key}`, saved);
    },
    { key, saved },
  );
}

// Requires a disposable planned record, which appears under Unknown project.
const attentionKey = await page.evaluate(
  () =>
    document.querySelector('[data-wt-project]:not([data-attention="0"])')
      ?.dataset.wtProject,
);
assert(
  attentionKey,
  "Create a disposable planned record to check attention reopening",
);
const original = await page.evaluate(
  (key) => localStorage.getItem(`wt:collapsed:${key}`),
  attentionKey,
);
try {
  await page.evaluate(
    (key) => localStorage.setItem(`wt:collapsed:${key}`, "true"),
    attentionKey,
  );
  await page.goto("http://127.0.0.1:38886/plugins/wt/worktrees");
  await page.waitForSelector(`[data-wt-project="${attentionKey}"] > button`);
  assert(
    await page.evaluate(
      (key) =>
        document
          .querySelector(`[data-wt-project="${key}"] > button`)
          .getAttribute("aria-expanded") === "true",
      attentionKey,
    ),
    "Attention must override a remembered collapse",
  );
  console.log(
    "PASS: project needing attention opens despite remembered collapse",
  );
} finally {
  await page.evaluate(
    ({ key, original }) => {
      if (original === null) localStorage.removeItem(`wt:collapsed:${key}`);
      else localStorage.setItem(`wt:collapsed:${key}`, original);
    },
    { key: attentionKey, original },
  );
}
