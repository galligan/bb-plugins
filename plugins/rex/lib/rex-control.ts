// A Rex control connection: one JSON object per WebSocket text message, over
// the server's Unix socket. See "The Control Connection" in the Rex API page.

import { connect } from "node:net";

import WebSocket, { type RawData } from "ws";
import { z } from "zod";

import { PaneError } from "./pane-error.ts";

/** The API revision this plugin was written against. */
const API_REVISION = 11;
const CONTROL_SUBPROTOCOL = "rex.control.v1";
const STEP_TIMEOUT_MS = 10_000;

const welcomeSchema = z.object({
  type: z.literal("welcome"),
  protocol: z.literal(CONTROL_SUBPROTOCOL),
});

const responseSchema = z.object({
  type: z.literal("response"),
  id: z.string(),
  payload: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).nullish(),
});

interface Waiter {
  method: string;
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  return Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
}

/** Opens a WebSocket to the Rex server and checks the subprotocol it chose. */
export function openRexSocket(
  socketPath: string,
  requestPath: string,
  subprotocol: string,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    // The URL's host is ignored over a Unix socket. The socket is dialled here
    // because ws reads a `ws+unix:` URL's path percent-encoded, and the
    // default Rex socket is under "Application Support". Compression stays
    // off: the hello must not be compressed and data connections never are.
    const socket = new WebSocket(
      `ws://localhost${requestPath}`,
      [subprotocol],
      {
        createConnection: () => connect(socketPath),
        perMessageDeflate: false,
        handshakeTimeout: STEP_TIMEOUT_MS,
      },
    );
    socket.once("open", () => {
      socket.removeAllListeners("error");
      // After this, a failure shows up as a close, which every user handles.
      socket.on("error", () => {});
      if (socket.protocol === subprotocol) {
        resolve(socket);
        return;
      }
      socket.terminate();
      reject(
        new PaneError(
          "rex_refused",
          `Rex chose subprotocol "${socket.protocol}" instead of ${subprotocol}.`,
        ),
      );
    });
    socket.once("error", (error) => {
      reject(
        new PaneError(
          "rex_unreachable",
          `Could not connect to the Rex server at ${socketPath}: ${error.message}`,
        ),
      );
    });
  });
}

/** The one thing most of this plugin needs of a control connection. */
export interface RexCaller {
  /** Calls a method and parses its result with `schema`. */
  call<T>(method: string, payload: unknown, schema: z.ZodType<T>): Promise<T>;
}

export class RexControl implements RexCaller {
  readonly #socket: WebSocket;
  readonly #pending = new Map<string, Waiter>();
  readonly #listeners: ((message: unknown) => void)[] = [];
  #nextId = 1;

  /** Connects, sends the hello, and waits for the welcome. */
  static async connect(socketPath: string): Promise<RexControl> {
    const socket = await openRexSocket(
      socketPath,
      "/api/control",
      CONTROL_SUBPROTOCOL,
    );
    const welcome = new Promise<void>((resolve, reject) => {
      const fail = (message: string) => {
        socket.terminate();
        reject(new PaneError("rex_refused", message));
      };
      const timer = setTimeout(
        () => fail("Rex did not answer the control hello."),
        STEP_TIMEOUT_MS,
      );
      socket.once("close", (code, reason) => {
        clearTimeout(timer);
        fail(`Rex closed the control connection: ${code} ${reason.toString()}`);
      });
      socket.once("message", (data) => {
        clearTimeout(timer);
        const parsed = welcomeSchema.safeParse(parseJson(data));
        if (parsed.success) resolve();
        else fail("Rex's first control message was not a welcome.");
      });
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        api_revision: API_REVISION,
        client: { kind: "other", name: "bb-plugin-rex" },
      }),
    );
    await welcome;
    socket.removeAllListeners("close");
    return new RexControl(socket);
  }

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on("message", (data) => this.#receive(parseJson(data)));
    socket.on("close", (code, reason) => {
      const error = new PaneError(
        "rex_unreachable",
        `The Rex control connection closed: ${code} ${reason.toString()}`,
      );
      for (const waiter of this.#pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      this.#pending.clear();
    });
  }

  #receive(message: unknown): void {
    // Anything that is not a response goes to the listeners: events, and
    // message types this plugin does not know, which they skip.
    const parsed = responseSchema.safeParse(message);
    if (!parsed.success) {
      for (const listener of this.#listeners) listener(message);
      return;
    }
    const waiter = this.#pending.get(parsed.data.id);
    if (waiter === undefined) return;
    this.#pending.delete(parsed.data.id);
    clearTimeout(waiter.timer);
    const { error, payload } = parsed.data;
    if (error == null) {
      waiter.resolve(payload);
      return;
    }
    waiter.reject(
      new PaneError(
        "rex_refused",
        `Rex refused ${waiter.method}: ${error.message} (${error.code})`,
        error.code,
      ),
    );
  }

  /** Calls a method and parses its result with `schema`. */
  async call<T>(
    method: string,
    payload: unknown,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const id = String(this.#nextId++);
    const result = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new PaneError("rex_unreachable", `Rex did not answer ${method}.`),
        );
      }, STEP_TIMEOUT_MS);
      this.#pending.set(id, { method, resolve, reject, timer });
      this.#socket.send(
        JSON.stringify({ type: "request", id, method, payload }),
      );
    });
    const parsed = schema.safeParse(result);
    if (parsed.success) return parsed.data;
    throw new PaneError(
      "rex_refused",
      `Rex answered ${method} in a shape this plugin does not read.`,
    );
  }

  /** Calls `listener` with every message from Rex that is not a response. */
  onMessage(listener: (message: unknown) => void): void {
    this.#listeners.push(listener);
  }

  onClose(listener: () => void): void {
    this.#socket.on("close", listener);
  }

  close(): void {
    this.#socket.close(1000);
  }
}

function parseJson(data: RawData): unknown {
  try {
    return JSON.parse(toBuffer(data).toString("utf8"));
  } catch {
    return null;
  }
}
