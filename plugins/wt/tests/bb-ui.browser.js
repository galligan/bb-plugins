// Run with bb browser-automation run SESSION --script-file ABSOLUTE_PATH --script-host HOST.
// Uses the running app. It changes unsaved drafts only; it never saves or removes.
const page = await browser.getPage("wt-ui-regression");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
await page.setViewport({ width: 390, height: 844, hasTouch: true });
await page.goto("http://127.0.0.1:38886/settings/plugins/wt");
await page.waitForSelector("#wt-branch-mode", { timeout: 15000 });
assert(
  await page.evaluate(
    () => document.querySelector("#wt-project").textContent.trim().length > 0,
  ),
  "Fresh compact project selection must have a visible label",
);
console.log("Opening branch mode");
await page.click("#wt-branch-mode");
await page.waitForSelector(
  "[data-persistent-drawer-content][data-state=open] [role=option]",
  { visible: true },
);
const options = await page.$$(
  "[data-persistent-drawer-content][data-state=open] [role=option]",
);
console.log("Selecting Custom", options.length);
await options[1].click();
await page.waitForSelector("#wt-project-prefix");
assert(
  await page.evaluate(() =>
    document
      .querySelector("#wt-branch-mode")
      .textContent.includes("Custom for this project"),
  ),
  "Compact Select must show the new label after choosing Custom",
);
console.log("Opening branch mode");
await page.click("#wt-branch-mode");
await page.waitForSelector(
  "[data-persistent-drawer-content][data-state=open] [role=option]",
  { visible: true },
);
await page.keyboard.press("Escape");
assert(
  await page.evaluate(() => document.activeElement.id === "wt-branch-mode"),
  "Escape must return focus to the compact Select trigger",
);
await page.waitForSelector(
  "[data-persistent-drawer-content][data-state=open]",
  { hidden: true },
);
console.log("Opening projects");
await page.click("#wt-project");
await page.waitForSelector(
  "[data-persistent-drawer-content][data-state=open] [role=option]",
  { visible: true },
);
const projects = await page.$$(
  "[data-persistent-drawer-content][data-state=open] [role=option]",
);
assert(projects.length > 1, "This live check needs two local projects");
const projectLabel = await projects[1].evaluate((element) =>
  element.textContent.trim(),
);
console.log("Selecting project", projectLabel);
await projects[1].click();
assert(
  await page.evaluate(
    (expected) =>
      document.querySelector("#wt-project").textContent.trim() === expected,
    projectLabel,
  ),
  "Compact project Select must show the newly selected label",
);
await page.waitForSelector("#wt-branch-mode");
await page.goto("http://127.0.0.1:38886/plugins/wt/worktrees");
await page.waitForSelector('[aria-label="Refresh worktrees"]');
assert(
  await page.evaluate(
    () =>
      [...document.querySelectorAll("h1, p")].filter(
        (heading) => heading.textContent === "Worktrees",
      ).length === 1,
  ),
  "Worktrees must use the single host title bar",
);
console.log(
  "PASS: compact Select labels, draft selection, Escape/focus, single native title bar",
);

// A fixture must have been created specifically for this check. Refuse all real rows.
await page.waitForFunction(() =>
  [...document.querySelectorAll("li")].some((row) =>
    row.textContent.includes("bbp25-ui-qa-"),
  ),
);
const rows = await page.$$("li");
let fixtureRow;
for (const row of rows) {
  if (
    await row.evaluate((element) =>
      element.textContent.includes("bbp25-ui-qa-"),
    )
  )
    fixtureRow = row;
}
assert(fixtureRow, "Create a disposable bbp25-ui-qa- worktree first");
const buttons = await fixtureRow.$$("button");
const remove = buttons[buttons.length - 1];
assert(
  await remove.evaluate((element) => element.textContent === "Remove"),
  "Fixture action must be Remove",
);
console.log("Opening disposable confirmation");
await remove.click();
await page.waitForSelector('[role="alertdialog"]', { visible: true });
assert(
  await page.evaluate(() =>
    document
      .querySelector('[role="alertdialog"]')
      .textContent.includes("bbp25-ui-qa-"),
  ),
  "Confirmation must target only the disposable fixture",
);
assert(
  await page.evaluate(() => document.activeElement.textContent === "Cancel"),
  "Cancel must receive initial focus",
);
await page.keyboard.press("Escape");
await page.waitForSelector('[role="alertdialog"]', { hidden: true });
assert(
  await remove.evaluate((element) => document.activeElement === element),
  "Escape must return focus to Remove",
);
console.log(
  "PASS: disposable removal confirmation, safe initial focus, Escape and focus return; no removal requested",
);
