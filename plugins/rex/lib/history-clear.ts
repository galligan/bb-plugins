// Spots a program clearing the terminal's history in its output.
//
// A snapshot's older pages are restored long after the snapshot arrived. If
// the program has cleared the scrollback since, libghostty would still put
// those pages back above the cleared screen. The terminal has no way to say
// its history was cleared, and counting rows cannot tell a clear followed by
// more output from output alone. So the output is watched for the two
// sequences that clear history: `CSI 3 J`, which `clear` sends, and the full
// reset `ESC c`.

const ESC = 0x1b;
/** `ESC [ 3 J`. */
const ERASE_SCROLLBACK = [ESC, 0x5b, 0x33, 0x4a];
/** The `c` of `ESC c`. */
const RESET = 0x63;

export class HistoryClearScan {
  /** How many bytes of a sequence the output so far ends with. */
  #matched = 0;

  /**
   * Takes the next bytes of output. Returns whether a sequence that clears
   * history ended in them. A sequence may be split across calls.
   */
  push(bytes: Uint8Array): boolean {
    let found = false;
    let at = 0;
    while (at < bytes.length) {
      if (this.#matched === 0) {
        const escape = bytes.indexOf(ESC, at);
        if (escape === -1) break;
        this.#matched = 1;
        at = escape + 1;
        continue;
      }
      const byte = bytes[at];
      at += 1;
      if (byte === ESC) {
        this.#matched = 1;
      } else if (this.#matched === 1 && byte === RESET) {
        found = true;
        this.#matched = 0;
      } else if (byte === ERASE_SCROLLBACK[this.#matched]) {
        this.#matched += 1;
        if (this.#matched === ERASE_SCROLLBACK.length) {
          found = true;
          this.#matched = 0;
        }
      } else {
        this.#matched = 0;
      }
    }
    return found;
  }
}
