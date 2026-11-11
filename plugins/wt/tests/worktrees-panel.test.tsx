// Worktrees panel behavior through the SDK frontend harness. Layout, themes,
// touch sizing, and the host's title bar are not reproducible in jsdom and stay
// live checks; see docs/dev/verification.md.
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import {
  noRescues,
  overview,
  presentRow,
  project,
  thread,
  type Overview,
  type Rescues,
} from "./fixtures.ts";

const loaded = () => loadPluginApp(() => import("../app.tsx"));

async function panel(
  data: Overview | (() => Overview | Promise<Overview>),
  rescues: Rescues = noRescues,
) {
  const app = await loaded();
  const slot = renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      rpc: {
        overview: typeof data === "function" ? data : () => data,
        rescues: () => rescues,
      },
    },
  );
  return { app, slot };
}

const calls = (slot: { inspection: { rpcCalls: { method: string }[] } }) =>
  slot.inspection.rpcCalls.map((call) => call.method);

test("registers the settings section, the panel with a host header action, and the provider inputs", async () => {
  const app = await loaded();
  expect(app.settingsSections.map((section) => section.id)).toEqual([
    "projects",
  ]);
  expect(app.navPanels).toHaveLength(1);
  expect(app.navPanels[0]).toMatchObject({
    id: "worktrees",
    title: "Worktrees",
    path: "worktrees",
  });
  expect(app.navPanels[0]!.headerContent).toBeTypeOf("function");
  expect(
    app.environmentProviderInputs.map((input) => input.environmentProviderId),
  ).toEqual(["wt"]);
});

test("shows loading, then rows grouped under their project", async () => {
  let resolve!: (value: Overview) => void;
  const { slot } = await panel(
    () =>
      new Promise<Overview>((done) => {
        resolve = done;
      }),
  );
  await slot.findByText("Loading worktrees…");
  resolve(overview([presentRow()]));
  await slot.findByText("feat/login");
  expect(slot.queryByText("Loading worktrees…")).toBeNull();
  expect(slot.getByRole("button", { name: /Acme/ }).textContent).toContain(
    "1 worktree",
  );
  // A healthy row in use is quiet: no state badge at all.
  for (const badge of ["Needs attention", "Retiring", "Orphaned", "UNSAVED"])
    expect(slot.queryByText(badge)).toBeNull();
});

test("an empty overview and a failed overview are distinct states", async () => {
  const empty = await panel(overview([]));
  await empty.slot.findByText("No Worktree+ worktrees.");
  empty.slot.lifecycle.unmount();

  const failed = await panel(() => {
    throw new Error("host offline");
  });
  await failed.slot.findByText(
    "Could not load worktrees. Refresh to try again.",
  );
  expect(failed.slot.queryByText("No Worktree+ worktrees.")).toBeNull();
});

test("the header action reloads after a failure and is disabled while a load is pending", async () => {
  let fail = true;
  let release: (() => void) | undefined;
  const { app, slot } = await panel(async () => {
    if (fail) throw new Error("host offline");
    await new Promise<void>((done) => {
      release = done;
    });
    return overview([presentRow()]);
  });
  const header = renderSlot(
    { component: app.navPanels[0]!.headerContent! },
    { subPath: "" },
  );
  await slot.findByText("Could not load worktrees. Refresh to try again.");
  const refresh = header.getByRole("button", { name: "Refresh worktrees" });
  await waitFor(() => expect(refresh).toHaveProperty("disabled", false));

  fail = false;
  await userEvent.click(refresh);
  await waitFor(() => expect(refresh).toHaveProperty("disabled", true));
  release!();
  await slot.findByText("feat/login");
  expect(slot.queryByText(/Could not load worktrees/)).toBeNull();
  await waitFor(() => expect(refresh).toHaveProperty("disabled", false));
  header.lifecycle.unmount();
});

test("a machine that cannot be read is named while other machines' rows stay visible", async () => {
  const data = overview([presentRow()]);
  data.machines.push({
    hostId: "host_linux",
    name: "Linux box",
    worktrees: [],
    error: "ssh timeout",
  });
  const { slot } = await panel(data);
  await slot.findByText("Linux box: worktrees unavailable");
  expect(slot.getByText("feat/login")).toBeTruthy();
});

test("row badges follow the worktree's state", async () => {
  const { slot } = await panel(
    overview([
      {
        status: "missing",
        pathKey: "acme-gone",
        path: "/worktrees/acme/gone",
        environment: null,
        projectId: project.id,
        threads: [],
      },
      presentRow({
        pathKey: "acme-retiring",
        inspection: { branch: "feat/retiring" },
        environment: { retireAt: Date.now() + 5 * 60_000 },
      }),
      presentRow({
        pathKey: "acme-orphan",
        inspection: { branch: "feat/orphan" },
        environment: null,
        projectId: project.id,
        threads: [],
      }),
      presentRow({
        pathKey: "acme-dirty",
        inspection: {
          branch: "feat/dirty",
          changedFiles: 2,
          safeToRemove: false,
          reasons: ["2 changed files"],
        },
      }),
    ]),
  );
  await slot.findByText("feat/retiring");
  const row = (label: string) =>
    slot.getByText(label).closest("[data-wt-row]")!.textContent;
  expect(row("acme-gone")).toContain("Needs attention");
  expect(row("acme-gone")).toContain("The folder no longer exists");
  expect(row("feat/retiring")).toContain("Retiring");
  expect(row("feat/retiring")).toMatch(/Removes in \dm/);
  expect(row("feat/orphan")).toContain("Orphaned");
  expect(row("feat/dirty")).toContain("UNSAVED");
  expect(row("feat/dirty")).toContain("2 changed files");
  expect(slot.getByRole("button", { name: /Acme/ }).textContent).toContain(
    "4 worktrees",
  );
});

test("a collapsed project is remembered across mounts and reopens from the keyboard", async () => {
  const first = await panel(overview([presentRow()]));
  await first.slot.findByText("feat/login");
  const trigger = first.slot.getByRole("button", { name: /Acme/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(localStorage.getItem(`wt:collapsed:${project.id}`)).toBe("true");
  first.slot.lifecycle.unmount();

  const second = await panel(overview([presentRow()]));
  const remembered = await second.slot.findByRole("button", { name: /Acme/ });
  expect(remembered.getAttribute("aria-expanded")).toBe("false");
  expect(second.slot.queryByText("feat/login")).toBeNull();

  remembered.focus();
  await userEvent.keyboard("{Enter}");
  expect(remembered.getAttribute("aria-expanded")).toBe("true");
  await second.slot.findByText("feat/login");
  expect(localStorage.getItem(`wt:collapsed:${project.id}`)).toBe("false");
});

test("a project needing attention opens despite a remembered collapse", async () => {
  localStorage.setItem(`wt:collapsed:${project.id}`, "true");
  const { slot } = await panel(
    overview([
      presentRow({
        environment: { teardown: { status: "failed", message: "rm refused" } },
      }),
    ]),
  );
  const trigger = await slot.findByRole("button", { name: /Acme/ });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(slot.getByLabelText("1 need attention")).toBeTruthy();
  expect(slot.getByText("rm refused")).toBeTruthy();
});

test("an archived first thread keeps a visible and accessible marker, and opens that thread", async () => {
  const { slot } = await panel(
    overview([
      presentRow({
        threads: [thread({ title: "Archived label", archived: true })],
      }),
    ]),
  );
  const open = await slot.findByRole("button", {
    name: "Open thread: Archived label (archived)",
  });
  expect(open.textContent).toContain("(archived)");
  await userEvent.click(open);
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "toThread", threadId: "thr_login" },
  ]);
});

test("further threads open in a popover that returns focus on Escape", async () => {
  const { slot } = await panel(
    overview([
      presentRow({
        threads: [
          thread(),
          thread({ id: "thr_two", title: "Second look" }),
          thread({ id: "thr_three", title: "Old attempt", archived: true }),
        ],
      }),
    ]),
  );
  const more = await slot.findByRole("button", { name: "2 more threads" });
  await userEvent.click(more);
  const second = await slot.findByRole("button", { name: "Second look" });
  expect(
    slot.getByText("Old attempt").closest("button")!.textContent,
  ).toContain("(archived)");
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(slot.queryByRole("button", { name: "Second look" })).toBeNull(),
  );
  expect(document.activeElement).toBe(more);
  expect(second.isConnected).toBe(false);
});

test("a realtime change reloads the overview and rescues", async () => {
  let rows = [presentRow()];
  const { slot } = await panel(() => overview(rows));
  await slot.findByText("feat/login");
  expect(calls(slot)).toEqual(["overview", "rescues"]);
  rows = [presentRow({ inspection: { branch: "feat/renamed" } })];
  await slot.behavior.emitRealtime("worktrees-changed", {});
  await slot.findByText("feat/renamed");
  expect(calls(slot)).toEqual(["overview", "rescues", "overview", "rescues"]);
});

test("rescued work lists each ref with its restore command, and an unreadable host is flagged", async () => {
  const { slot } = await panel(overview([presentRow()]), {
    projects: [
      {
        projectId: project.id,
        hostId: "host_mac",
        refs: [
          {
            ref: "refs/wt-rescue/acme-feat-old/1700000000000",
            commit: "0123456789abcdef0123456789abcdef01234567",
            subject: "Uncommitted work from feat/old",
            createdAt: 1_700_000_000_000,
          },
        ],
        error: null,
      },
      {
        projectId: project.id,
        hostId: "host_linux",
        refs: [],
        error: "git unavailable",
      },
    ],
  });
  await slot.findByText("Uncommitted work from feat/old");
  expect(
    slot.getByRole("button", { name: /Rescued work · Acme · Mac/ }).textContent,
  ).toContain("1 ref");
  expect(slot.getByText("0123456789")).toBeTruthy();
  expect(
    slot.getAllByText(/refs\/wt-rescue\/acme-feat-old\/1700000000000/).length,
  ).toBeGreaterThan(1);
  await slot.findByText("Rescue refs could not be read on this machine.");
});
