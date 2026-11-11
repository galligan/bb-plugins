// A Rex server small enough to hold in a test: sessions, their windows, and
// the handful of control methods the plugin calls to manage them. It answers
// in the shapes the Rex API page gives, and refuses as Rex does.

import type { z } from "zod";

import { PaneError } from "./pane-error.ts";
import type { RexCaller } from "./rex-control.ts";

interface FakeBlock {
  id: string;
  label: string;
  creator: string;
  cwd: string | null;
}

interface FakeWindow {
  id: string;
  label: string;
  blocks: FakeBlock[];
  /** The pane with focus. The window's first, unless a test moves it. */
  focusedBlockId: string | null;
}

interface FakeSession {
  id: string;
  label: string;
  windows: FakeWindow[];
  activeWindowId: string | null;
}

const TERMINAL = "com.superlogical.terminal";

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

export class FakeRex implements RexCaller {
  readonly sessions: FakeSession[] = [];
  /** Every call made, in order, as `[method, payload]`. */
  readonly calls: [string, unknown][] = [];
  /** The sessions the default connection, `call`, has attached to. */
  readonly #attached = new Set<string>();
  #nextId = 1;

  #id(kind: string): string {
    return `${kind}:${this.#nextId++}`;
  }

  /** Adds a session as the user might have: one window with one shell. */
  addSession(label: string, windowLabels = ["Window 1"]): FakeSession {
    const session: FakeSession = {
      id: this.#id("session"),
      label,
      windows: [],
      activeWindowId: null,
    };
    for (const windowLabel of windowLabels) {
      session.activeWindowId = this.#addWindow(session, windowLabel, null).id;
    }
    this.sessions.push(session);
    return session;
  }

  /** Splits a window as a person might in Rex: adds one more pane to it. */
  split(window: FakeWindow, label = "shell", creator = TERMINAL): FakeBlock {
    const block = { id: this.#id("block"), label, creator, cwd: null };
    window.blocks.push(block);
    return block;
  }

  /** The methods called, without their payloads. */
  get methods(): string[] {
    return this.calls.map(([method]) => method);
  }

  /** Opens one more window in a session, as a person might in Rex. */
  openWindow(session: FakeSession, label: string): void {
    this.#addWindow(session, label, null);
  }

  #addWindow(
    session: FakeSession,
    label: string,
    cwd: string | null,
  ): FakeWindow {
    const block = {
      id: this.#id("block"),
      label: "shell",
      creator: TERMINAL,
      cwd,
    };
    const window: FakeWindow = {
      id: this.#id("window"),
      label,
      blocks: [block],
      focusedBlockId: block.id,
    };
    session.windows.push(window);
    return window;
  }

  #session(id: unknown): FakeSession {
    const session = this.sessions.find((candidate) => candidate.id === id);
    if (session === undefined) {
      throw new PaneError(
        "rex_refused",
        `session ${text(id)} not found`,
        "session_not_found",
      );
    }
    return session;
  }

  #window(session: FakeSession, id: unknown): FakeWindow {
    const window = session.windows.find((candidate) => candidate.id === id);
    if (window === undefined) {
      throw new PaneError(
        "rex_refused",
        `window ${text(id)} not found`,
        "not_found",
      );
    }
    return window;
  }

  call<T>(method: string, payload: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.#call(method, payload, schema, this.#attached);
  }

  /**
   * One more control connection to the same server. Attachment is kept per
   * connection, as in Rex: a new connection is attached to nothing, whatever
   * an earlier one attached to.
   */
  connection(): RexCaller {
    const attached = new Set<string>();
    return {
      call: (method, payload, schema) =>
        this.#call(method, payload, schema, attached),
    };
  }

  #call<T>(
    method: string,
    payload: unknown,
    schema: z.ZodType<T>,
    attached: Set<string>,
  ): Promise<T> {
    this.calls.push([method, payload]);
    try {
      return Promise.resolve(
        schema.parse(this.#answer(method, payload, attached)),
      );
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  #answer(method: string, payload: unknown, attached: Set<string>): unknown {
    const args = record(payload);
    if (method === "session.list") {
      return {
        sessions: this.sessions.map((session) => ({
          session_id: session.id,
          label: session.label,
        })),
      };
    }
    if (method === "session.create") {
      const session: FakeSession = {
        id: this.#id("session"),
        label: text(args.label),
        windows: [],
        activeWindowId: null,
      };
      const requested = Array.isArray(args.initial_windows)
        ? args.initial_windows
        : [];
      const made = requested.map((entry) => this.#make(session, entry));
      session.activeWindowId = made.at(-1)?.id ?? null;
      this.sessions.push(session);
      return {
        session_id: session.id,
        initial_windows: made.map((window) => ({
          window_id: window.id,
          block_ids: window.blocks.map((block) => block.id),
          revision: 1,
        })),
      };
    }
    if (method === "target.complete") {
      // Answers without the connection being attached, as Rex does.
      const session = this.#session(record(args.scope).session);
      return { completions: this.#completions(session) };
    }
    const session = this.#session(args.session_id);
    if (method === "session.attach") {
      attached.add(session.id);
      return { client_id: "client:test", view: this.#view(session) };
    }
    // Rex takes a change to a session only from a connection attached to it.
    if (!attached.has(session.id)) {
      throw new PaneError(
        "rex_refused",
        `stream is not attached to session ${session.id}`,
        "conflict",
      );
    }
    if (method === "session.new_window") {
      const window = this.#make(session, args);
      if (args.focus !== false) session.activeWindowId = window.id;
      return {
        window_id: window.id,
        block_ids: window.blocks.map((block) => block.id),
        revision: 2,
      };
    }
    const window = this.#window(session, args.window_id);
    if (method === "session.set_window_label") {
      window.label = text(args.label);
      return { revision: 3 };
    }
    if (method === "session.close_window") {
      session.windows.splice(session.windows.indexOf(window), 1);
      if (session.activeWindowId === window.id) {
        session.activeWindowId = session.windows[0]?.id ?? null;
      }
      return { revision: 4 };
    }
    throw new PaneError("rex_refused", `no fake for ${method}`, "bad_request");
  }

  #view(session: FakeSession): unknown {
    return {
      revision: 1,
      session_id: session.id,
      label: session.label,
      active_window_id: session.activeWindowId,
      windows: session.windows.map((window) => ({
        window_id: window.id,
        label: window.label,
        focused_block_id: window.focusedBlockId ?? undefined,
        layers: [
          {
            blocks: window.blocks.map((block) => ({
              block_id: block.id,
              creator_name: block.creator,
            })),
          },
        ],
      })),
    };
  }

  /** Every window and block of a session, once for each way of naming it. */
  #completions(session: FakeSession): unknown[] {
    const shortId = (id: string) => id.slice(id.indexOf(":") + 1);
    const windows = session.windows.map((window, index) => ({
      kind: "window",
      session_id: session.id,
      window_id: window.id,
      label: window.label,
      ordinal: index + 1,
    }));
    const blocks = session.windows.flatMap((window, index) =>
      window.blocks.map((block) => ({
        kind: "block",
        session_id: session.id,
        window_id: window.id,
        block_id: block.id,
        label: block.label,
        where: `window ${index + 1}`,
      })),
    );
    return [
      ...windows.map((target) => ({
        value: target.label,
        form: "label",
        target,
      })),
      ...windows.map((target) => ({
        value: String(target.ordinal),
        form: "ordinal",
        target,
      })),
      // Rex lists short IDs in sorted order, not window order.
      ...windows
        .map((target) => ({
          value: shortId(target.window_id),
          form: "id",
          target,
        }))
        .reverse(),
      ...blocks.map((target) => ({
        value: target.label,
        form: "label",
        target,
      })),
      ...blocks.map((target) => ({
        value: shortId(target.block_id),
        form: "id",
        target,
      })),
    ];
  }

  /** Makes a window from the arguments of `new_window` or `initial_windows`. */
  #make(session: FakeSession, entry: unknown): FakeWindow {
    const args = record(entry);
    const options = record(record(record(args.layout).block).options);
    return this.#addWindow(
      session,
      text(args.window_label),
      typeof options.cwd === "string" ? options.cwd : null,
    );
  }
}
