// The Rex tab's registration and its connection states through the SDK
// frontend harness. The tab talks to the plugin's own HTTP routes with `fetch`,
// so `fetch` is the seam here; the routes themselves are tested in
// lib/server.test.ts.
//
// Not covered: an open terminal. Drawing, scrolling, keyboard input and the
// decoded stream need a canvas and a live byte stream; decoding is tested in
// lib/ against the real WASM, and the rest is a live check.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { RexTab } from "../components/rex-tab.tsx";

const THREAD = "thr_one";
// Vitest runs from the package root; under jsdom `import.meta.url` is not a file URL.
const wasm = await readFile(join(process.cwd(), "vendor/ghostty-vt.wasm"));

/** Stubs `fetch`: the real decoder for the WASM route, `stream` for the rest. */
function routes(stream: (url: URL) => Response | Promise<Response>) {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), "http://bb.test");
      requests.push(
        `${url.pathname.replace("/api/v1/plugins/rex/http", "")}${url.search}`,
      );
      if (url.pathname.endsWith("/ghostty-vt.wasm"))
        return new Response(new Uint8Array(wasm), {
          headers: { "content-type": "application/wasm" },
        });
      return stream(url);
    }),
  );
  return requests;
}

const refusal = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

const tab = () =>
  renderSlot(
    { component: RexTab },
    { threadId: THREAD, environment: null, params: null },
  );

test("registers one flush thread tab that opens on request", async () => {
  const app = await loadPluginApp(() => import("../app.tsx"));
  expect(app.tabs).toHaveLength(1);
  expect(app.tabs[0]).toMatchObject({
    id: "pane",
    title: "Rex",
    context: { kind: "thread" },
    availability: "action",
    layout: "flush",
  });
  expect(app.tabs[0]!.component).toBe(RexTab);
  expect(app.navPanels).toEqual([]);
  expect(app.settingsSections).toEqual([]);
});

test("shows connecting, then the server's own reason when the stream is refused, and retries on request", async () => {
  let release!: (response: Response) => void;
  let attempts = 0;
  const requests = routes(() => {
    attempts += 1;
    return attempts === 1
      ? new Promise<Response>((done) => {
          release = done;
        })
      : refusal(409, "no_terminal", "The session has no terminal to show.");
  });
  const slot = tab();
  await slot.findByText("Connecting to Rex…");
  release(
    refusal(
      503,
      "rex_unreachable",
      "The rex command is not on the bb server's PATH.",
    ),
  );
  await slot.findByText("The rex command is not on the bb server's PATH.");
  // jsdom cannot measure media-query layout; assert the registry's compact
  // touch sizing contract here and measure the rendered controls in BB.
  expect(slot.getByRole("button", { name: "Try again" }).classList).toContain(
    "max-md:pointer-coarse:h-9",
  );
  expect(slot.queryByText("Connecting to Rex…")).toBeNull();
  expect(requests.filter((path) => path.startsWith("/stream"))).toEqual([
    `/stream?thread=${THREAD}`,
  ]);

  await userEvent.click(slot.getByRole("button", { name: "Try again" }));
  await slot.findByText("The session has no terminal to show.");
  expect(requests.filter((path) => path.startsWith("/stream"))).toHaveLength(2);
  // The decoder is compiled once and shared across attempts.
  expect(requests.filter((path) => path === "/ghostty-vt.wasm")).toHaveLength(
    1,
  );
});

test("a failure without a readable body names the route and status", async () => {
  routes(() => new Response("upstream timeout", { status: 504 }));
  const slot = tab();
  await slot.findByText("The Rex stream request failed with HTTP 504.");
  expect(slot.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("a stream without its pane headers is refused instead of being shown", async () => {
  routes(() => new Response(new Uint8Array([1, 2, 3])));
  const slot = tab();
  await slot.findByText("The Rex stream response is missing its pane headers.");
});

test("an ended stream exposes a touch-sized reconnect that requests a fresh stream", async () => {
  const requests = routes(
    () =>
      new Response(new Uint8Array(), {
        headers: {
          "x-rex-pane": "pane_one",
          "x-rex-nonce": "nonce_one",
          "x-rex-session-label": "test session",
          "x-rex-window-label": "test window",
        },
      }),
  );
  const slot = tab();
  const reconnect = await slot.findByRole("button", { name: "Reconnect" });
  expect(reconnect.classList).toContain("max-md:pointer-coarse:h-9");
  expect(
    slot.getByRole("button", { name: /Choose the Rex window/ }).classList,
  ).toContain("max-md:pointer-coarse:h-9");
  await userEvent.click(reconnect);
  await slot.findByRole("button", { name: "Reconnect" });
  expect(requests.filter((path) => path.startsWith("/stream"))).toEqual([
    `/stream?thread=${THREAD}`,
    `/stream?thread=${THREAD}`,
  ]);
});

test("session headings distinguish a session from a window with the same label", async () => {
  routes((url) =>
    url.pathname.endsWith("/targets")
      ? Response.json({
          own: null,
          pick: null,
          sessions: [
            {
              sessionId: "session_one",
              label: "work",
              windows: [{ windowId: "window_one", label: "work", panes: [] }],
            },
          ],
        })
      : refusal(503, "rex_unreachable", "Unavailable"),
  );
  const slot = tab();
  await slot.findByText("Unavailable");
  await userEvent.click(
    slot.getByRole("button", { name: /Choose the Rex window/ }),
  );
  await slot.findByText("Session: work");
  expect(slot.getByRole("group", { name: "work" })).toBeTruthy();
  expect(slot.getByRole("menuitemcheckbox", { name: "work" })).toBeTruthy();
});
