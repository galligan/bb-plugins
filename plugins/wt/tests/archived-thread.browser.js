// Read-only presentation fixture: override one overview response in this page.
// No thread is created, archived or changed on the server.
const page = await browser.getPage("archived-thread-regression");
await page.setViewport({ width: 1440, height: 1000 });
await page.setRequestInterception(true);
const intercept = async (request) => {
  if (new URL(request.url()).pathname !== "/api/v1/plugins/wt/rpc/overview") {
    await request.continue();
    return;
  }
  const response = await fetch(request.url(), {
    method: request.method(),
    headers: request.headers(),
    body: request.postData(),
  });
  const data = await response.json();
  const row = data.result.machines
    .flatMap((machine) => machine.worktrees)
    .find((row) => row.threads.length > 0);
  if (!row) throw new Error("This live fixture needs a worktree with a thread");
  row.threads = [
    { ...row.threads[0], title: "Archived label regression", archived: true },
  ];
  await request.respond({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
};
page.on("request", intercept);
try {
  await page.goto("http://127.0.0.1:38886/plugins/wt/worktrees");
  await page.waitForSelector(
    '[aria-label="Open thread: Archived label regression (archived)"]',
    { timeout: 15000 },
  );
  const marked = await page.evaluate(() =>
    document
      .querySelector(
        '[aria-label="Open thread: Archived label regression (archived)"]',
      )
      .textContent.includes("(archived)"),
  );
  if (!marked)
    throw new Error("The first archived thread must retain its visible status");
  console.log(
    "PASS: first archived thread has a visible and accessible archived marker; server state unchanged",
  );
} finally {
  await page.setRequestInterception(false);
  page.off("request", intercept);
}
