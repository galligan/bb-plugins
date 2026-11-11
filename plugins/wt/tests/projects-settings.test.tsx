// Project settings through the SDK frontend harness. The compact drawer form of
// the Select and its touch sizing depend on layout and stay live checks.
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { z } from "zod";
import type { rpcContract } from "../server.ts";

type Settings = z.infer<typeof rpcContract.projectSettings.output>;
type Detection = z.infer<typeof rpcContract.detectSetup.output>;

const projects = [
  { id: "proj_acme", name: "Acme", hostId: "host_mac", hostName: "Mac" },
  { id: "proj_beta", name: "Beta", hostId: "host_mac", hostName: "Mac" },
];
const global = { prefixBranches: true, branchPrefix: "wt/" };
const settings = (stored: Settings["stored"] = null): Settings => ({
  stored,
  global,
  effective: {
    prefixBranches: stored?.prefixBranches ?? global.prefixBranches,
    branchPrefix: stored?.branchPrefix ?? global.branchPrefix,
  },
  managedBranchPrefix: "bb/",
});
const detection: Detection = {
  source: "none",
  setup: null,
  cleanup: null,
  hooks: { setup: false, teardown: false },
  sharedFiles: { patternFile: false, files: [] },
  error: null,
};

type Handlers = {
  projects?: () => typeof projects;
  projectSettings?: () => Settings;
  setProjectSettings?: () => Settings | Promise<Settings>;
  detectSetup?: () => Detection;
};

async function section(handlers: Handlers = {}) {
  const app = await loadPluginApp(() => import("../app.tsx"));
  const slot = renderSlot(
    app.settingsSections[0]!,
    {},
    {
      rpc: {
        projects: () => projects,
        projectSettings: () => settings(),
        detectSetup: () => detection,
        ...handlers,
      },
    },
  );
  const inputsOf = (method: string) =>
    slot.inspection.rpcCalls
      .filter((call) => call.method === method)
      .map((call) => call.input);
  return { slot, inputsOf };
}

async function choose(
  slot: Awaited<ReturnType<typeof section>>["slot"],
  trigger: HTMLElement,
  option: string,
) {
  await userEvent.click(trigger);
  await userEvent.click(await slot.findByRole("option", { name: option }));
}

test("loads the first project, and a chosen project is remembered and loads its own settings", async () => {
  const first = await section();
  const project = await first.slot.findByRole("combobox", { name: "Project" });
  expect(project.textContent).toBe("Acme · Mac");
  await first.slot.findByRole("combobox", { name: "Branch naming" });
  expect(first.inputsOf("projectSettings")).toEqual([
    { projectId: "proj_acme" },
  ]);
  expect(first.inputsOf("detectSetup")).toEqual([
    { projectId: "proj_acme", hostId: "host_mac" },
  ]);

  await choose(first.slot, project, "Beta · Mac");
  await waitFor(() => expect(project.textContent).toBe("Beta · Mac"));
  expect(localStorage.getItem("wt:project")).toBe("proj_beta:host_mac");
  await waitFor(() =>
    expect(first.inputsOf("projectSettings").at(-1)).toEqual({
      projectId: "proj_beta",
    }),
  );
  first.slot.lifecycle.unmount();

  const second = await section();
  const remembered = await second.slot.findByRole("combobox", {
    name: "Project",
  });
  expect(remembered.textContent).toBe("Beta · Mac");
});

test("no projects and a failed project read are distinct states", async () => {
  const empty = await section({ projects: () => [] });
  await empty.slot.findByText(
    "No projects with a local checkout on a connected machine.",
  );
  empty.slot.lifecycle.unmount();

  const failed = await section({
    projects: () => {
      throw new Error("server unavailable");
    },
  });
  await failed.slot.findByText("server unavailable");
  expect(failed.slot.queryByRole("combobox")).toBeNull();
});

test("Escape closes the branch-naming list and returns focus to its trigger", async () => {
  const { slot } = await section();
  const mode = await slot.findByRole("combobox", { name: "Branch naming" });
  expect(mode.textContent).toBe("Use global setting");
  await userEvent.click(mode);
  await slot.findByRole("option", { name: "Custom for this project" });
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(slot.queryByRole("option")).toBeNull());
  expect(document.activeElement).toBe(mode);
  expect(mode.textContent).toBe("Use global setting");
});

test("custom naming previews the branch, rejects an invalid prefix, and saves only when changed", async () => {
  let release!: (value: Settings) => void;
  const { slot, inputsOf } = await section({
    setProjectSettings: () =>
      new Promise<Settings>((done) => {
        release = done;
      }),
  });
  const mode = await slot.findByRole("combobox", { name: "Branch naming" });
  const save = slot.getByRole("button", { name: "Save" });
  expect(save).toHaveProperty("disabled", true);
  expect(slot.getByText("wt/fix-login-bug-thr_example")).toBeTruthy();

  await choose(slot, mode, "Custom for this project");
  expect(mode.textContent).toBe("Custom for this project");
  const prefix = await slot.findByRole("textbox", { name: "Branch prefix" });
  await userEvent.clear(prefix);
  await userEvent.type(prefix, "a..b");
  expect(slot.getByRole("alert").textContent).toBe(
    "Not a valid start for a git branch name",
  );
  expect(prefix.getAttribute("aria-invalid")).toBe("true");
  expect(save).toHaveProperty("disabled", true);

  await userEvent.clear(prefix);
  await userEvent.type(prefix, "team/");
  expect(slot.queryByRole("alert")).toBeNull();
  expect(slot.getByText("team/fix-login-bug-thr_example")).toBeTruthy();
  expect(save).toHaveProperty("disabled", false);

  await userEvent.click(save);
  const saving = await slot.findByRole("button", { name: "Saving…" });
  expect(saving).toHaveProperty("disabled", true);
  expect(prefix).toHaveProperty("disabled", true);
  await userEvent.click(saving);
  expect(inputsOf("setProjectSettings")).toEqual([
    {
      projectId: "proj_acme",
      patch: { prefixBranches: true, branchPrefix: "team/", scripts: null },
    },
  ]);

  release(
    settings({ version: 1, prefixBranches: true, branchPrefix: "team/" }),
  );
  const saved = await slot.findByRole("button", { name: "Save" });
  await waitFor(() => expect(saved).toHaveProperty("disabled", true));
  expect(slot.getByRole("textbox", { name: "Branch prefix" })).toHaveProperty(
    "value",
    "team/",
  );
});

test("a failed save keeps the draft and shows the reason", async () => {
  const { slot, inputsOf } = await section({
    setProjectSettings: () => {
      throw new Error("settings store is read-only");
    },
  });
  const mode = await slot.findByRole("combobox", { name: "Branch naming" });
  await choose(slot, mode, "Custom for this project");
  const prefix = await slot.findByRole("textbox", { name: "Branch prefix" });
  await userEvent.clear(prefix);
  await userEvent.type(prefix, "team/");
  await userEvent.click(slot.getByRole("button", { name: "Save" }));
  const alert = await slot.findByRole("alert");
  expect(alert.textContent).toBe("settings store is read-only");
  expect(prefix).toHaveProperty("value", "team/");
  expect(slot.getByRole("button", { name: "Save" })).toHaveProperty(
    "disabled",
    false,
  );
  expect(inputsOf("setProjectSettings")).toHaveLength(1);
});

test("a failed setup detection is reported without blocking branch settings", async () => {
  const { slot } = await section({
    detectSetup: () => {
      throw new Error("host unreachable");
    },
  });
  const alert = await slot.findByRole("alert");
  expect(alert.textContent).toBe("Setup detection: host unreachable");
  expect(slot.getByRole("combobox", { name: "Branch naming" })).toHaveProperty(
    "disabled",
    false,
  );
});
