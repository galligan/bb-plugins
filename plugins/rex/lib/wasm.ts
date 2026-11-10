// The calling convention for libghostty-vt's WebAssembly build.
//
// The module has no imports. Its C API takes pointers into its own linear
// memory, so a caller allocates there, writes arguments in, and reads results
// out. Pointers and `size_t` are 32 bits, and integers are little-endian.

/** libghostty-vt's GhosttyResult codes that callers here tell apart. */
export const RESULT = {
  success: 0,
  outOfSpace: -3,
  noValue: -4,
} as const;

const RESULT_NAMES = new Map([
  [0, "GHOSTTY_SUCCESS"],
  [-1, "GHOSTTY_OUT_OF_MEMORY"],
  [-2, "GHOSTTY_INVALID_VALUE"],
  [-3, "GHOSTTY_OUT_OF_SPACE"],
  [-4, "GHOSTTY_NO_VALUE"],
  [-5, "GHOSTTY_IO_ERROR"],
  [-6, "GHOSTTY_LIMIT_EXCEEDED"],
  [-7, "GHOSTTY_REJECTED"],
  [-8, "GHOSTTY_UNSUPPORTED"],
]);

/** A libghostty-vt call returned something other than success. */
export class GhosttyError extends Error {
  readonly result: number;

  constructor(what: string, result: number) {
    super(`${what}: ${RESULT_NAMES.get(result) ?? `result ${result}`}`);
    this.name = "GhosttyError";
    this.result = result;
  }
}

type WasmFunction = (...args: (number | bigint)[]) => number;

export class Wasm {
  readonly #exports: WebAssembly.Exports;
  readonly #memory: WebAssembly.Memory;
  readonly #functions = new Map<string, WasmFunction>();
  #bytes: Uint8Array;
  #view: DataView;

  constructor(instance: WebAssembly.Instance) {
    const memory = instance.exports.memory;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error("ghostty-vt.wasm does not export its memory.");
    }
    this.#exports = instance.exports;
    this.#memory = memory;
    this.#bytes = new Uint8Array(memory.buffer);
    this.#view = new DataView(memory.buffer);
  }

  // Any call can grow the memory, which replaces its buffer. Views made
  // before that no longer cover the live memory, so they are remade here.
  #refresh(): void {
    if (this.#bytes.buffer === this.#memory.buffer) return;
    this.#bytes = new Uint8Array(this.#memory.buffer);
    this.#view = new DataView(this.#memory.buffer);
  }

  get bytes(): Uint8Array {
    this.#refresh();
    return this.#bytes;
  }

  get view(): DataView {
    this.#refresh();
    return this.#view;
  }

  /** Calls an export. A function that returns nothing gives 0. */
  call(name: string, ...args: (number | bigint)[]): number {
    let callable = this.#functions.get(name);
    if (callable === undefined) {
      const exported = this.#exports[name];
      if (typeof exported !== "function") {
        throw new Error(`ghostty-vt.wasm has no function ${name}.`);
      }
      callable = (...callArgs) => {
        const result: unknown = exported(...callArgs);
        return typeof result === "number" ? result : 0;
      };
      this.#functions.set(name, callable);
    }
    return callable(...args);
  }

  /** Calls an export that returns a GhosttyResult, and throws unless it succeeded. */
  check(name: string, ...args: (number | bigint)[]): void {
    const result = this.call(name, ...args);
    if (result !== RESULT.success) throw new GhosttyError(name, result);
  }

  alloc(length: number): number {
    const pointer = this.call("ghostty_wasm_alloc", length);
    if (pointer === 0) throw new Error("libghostty-vt is out of memory.");
    return pointer;
  }

  free(pointer: number, length: number): void {
    this.call("ghostty_wasm_free", pointer, length);
  }

  /**
   * Runs a constructor that stores a new handle through an out-parameter.
   * `construct` receives the slot to pass and returns the call's result.
   */
  newHandle(what: string, construct: (slot: number) => number): number {
    const slot = this.call("ghostty_wasm_alloc_opaque");
    if (slot === 0) throw new Error("libghostty-vt is out of memory.");
    try {
      const result = construct(slot);
      if (result !== RESULT.success) throw new GhosttyError(what, result);
      return this.call("ghostty_wasm_take_opaque", slot);
    } finally {
      this.call("ghostty_wasm_free_opaque", slot);
    }
  }
}
