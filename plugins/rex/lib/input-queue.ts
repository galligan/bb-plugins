// Keeps input in the order it was typed on its way to the backend.
//
// Two HTTP requests sent close together can arrive in either order. So only
// one request is ever in flight: whatever is typed while it is out waits, and
// goes in the next request as one batch, in order. The backend sends a batch
// to Rex in order on one connection, where Rex keeps it in order too.

export class InputQueue<T> {
  readonly #send: (batch: T[]) => Promise<void>;
  readonly #onFailure: (error: unknown) => void;
  readonly #maxBatch: number;
  #waiting: T[] = [];
  #sending = false;

  /**
   * `send` delivers one batch and resolves once the backend has taken it.
   * When it rejects, the input still waiting is dropped and `onFailure` is
   * called: sending it late could type a command the user gave up on.
   */
  constructor(options: {
    send: (batch: T[]) => Promise<void>;
    onFailure: (error: unknown) => void;
    maxBatch: number;
  }) {
    this.#send = options.send;
    this.#onFailure = options.onFailure;
    this.#maxBatch = options.maxBatch;
  }

  push(item: T): void {
    this.#waiting.push(item);
    if (!this.#sending) void this.#drain();
  }

  async #drain(): Promise<void> {
    this.#sending = true;
    try {
      while (this.#waiting.length > 0) {
        await this.#send(this.#waiting.splice(0, this.#maxBatch));
      }
    } catch (error) {
      this.#waiting = [];
      this.#onFailure(error);
    } finally {
      this.#sending = false;
    }
  }
}
