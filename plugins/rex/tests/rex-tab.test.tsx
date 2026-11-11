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
function routes(stream: () => Response | Promise<Response>) {
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
      return stream();
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
