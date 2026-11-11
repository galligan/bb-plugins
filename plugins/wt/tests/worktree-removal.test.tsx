// Removal confirmation through the SDK frontend harness. The RPC is a handler
// in this test, so nothing is removed anywhere.
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { noRescues, overview, presentRow } from "./fixtures.ts";

type Removal =
  { status: "requested" | "removed" } | { status: "failed"; message: string };

async function panel(
  removeWorktree: () => Removal | Promise<Removal>,
  row = presentRow(),
) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      rpc: {
        overview: () => overview([row]),
        rescues: () => noRescues,
        removeWorktree,
      },
    },
  );
  const remove = await slot.findByRole("button", { name: "Remove worktree" });
  const removals = () =>
    slot.inspection.rpcCalls.filter((call) => call.method === "removeWorktree");
  return { slot, remove, removals };
}

test("the confirmation names the folder, focuses Cancel, and Escape returns focus without removing", async () => {
  const { slot, remove, removals } = await panel(() => ({ status: "removed" }));
  await userEvent.click(remove);
  const dialog = await slot.findByRole("alertdialog", {
    name: "Remove worktree?",
  });
  expect(within(dialog).getByText("/worktrees/acme/feat-login")).toBeTruthy();
  expect(document.activeElement).toBe(
    within(dialog).getByRole("button", { name: "Cancel" }),
  );
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(slot.queryByRole("alertdialog")).toBeNull());
  expect(document.activeElement).toBe(remove);
  expect(removals()).toEqual([]);
});

test("the confirmation separates what a rescue ref saves from what blocks removal", async () => {
  const { slot, remove } = await panel(
    () => ({ status: "removed" }),
    presentRow({
      inspection: {
        changedFiles: 1,
        untrackedFiles: 2,
        conflictedFiles: 1,
        safeToRemove: false,
      },
    }),
  );
  await userEvent.click(remove);
  const dialog = await slot.findByRole("alertdialog");
  const text = dialog.textContent;
  expect(text).toContain("Saved to a rescue ref");
  expect(text).toContain("Uncommitted tracked files will be saved");
  expect(text).toContain("Untracked files will be saved");
  expect(text).toContain("Blocks removal");
  expect(text).toContain("Unresolved conflicts block removal.");
});

test("confirming sends one request for that worktree, ignores a second click while pending, then reloads", async () => {
  let release!: (result: Removal) => void;
  const { slot, remove, removals } = await panel(
    () =>
      new Promise<Removal>((done) => {
        release = done;
      }),
  );
  await userEvent.click(remove);
  const dialog = await slot.findByRole("alertdialog");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Remove worktree" }),
  );
  const pending = await within(dialog).findByRole("button", {
    name: "Requesting…",
  });
  expect(pending).toHaveProperty("disabled", true);
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveProperty(
    "disabled",
    true,
  );
  await userEvent.click(pending);
  await userEvent.keyboard("{Escape}");
  expect(slot.queryByRole("alertdialog")).not.toBeNull();
  expect(removals()).toEqual([
    {
      method: "removeWorktree",
      input: { hostId: "host_mac", pathKey: "acme-feat-login" },
    },
  ]);

  const before = slot.inspection.rpcCalls.length;
  release({ status: "requested" });
  await waitFor(() => expect(slot.queryByRole("alertdialog")).toBeNull());
  expect(
    slot.inspection.rpcCalls.slice(before).map((call) => call.method),
  ).toEqual(["overview", "rescues"]);
  expect(removals()).toHaveLength(1);
});

test("a refused removal keeps the row, shows the reason, and offers a retry", async () => {
  const { slot, remove, removals } = await panel(() => ({
    status: "failed",
    message: "Unresolved conflicts block removal.",
  }));
  await userEvent.click(remove);
  const dialog = await slot.findByRole("alertdialog");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Remove worktree" }),
  );
  const alert = await within(dialog).findByRole("alert");
  expect(alert.textContent).toBe("Unresolved conflicts block removal.");
  await within(dialog).findByRole("button", { name: "Retry removal" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(slot.queryByRole("alertdialog")).toBeNull());

  expect(slot.getByText("feat/login")).toBeTruthy();
  await userEvent.click(slot.getByRole("button", { name: "Retry removal" }));
  const retry = await slot.findByRole("alertdialog", {
    name: "Retry removal?",
  });
  // Reopening clears the previous refusal instead of presenting it as current.
  expect(within(retry).queryByRole("alert")).toBeNull();
  expect(removals()).toHaveLength(1);
});
