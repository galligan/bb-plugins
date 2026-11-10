// What a turn of the wheel means in the terminal, worked out the way bb's
// built-in terminal works it out, so the two scroll alike.
//
// On the normal screen the wheel scrolls the history. bb's terminal does this
// with a scrolling element that moves 50 pixels for each "notch", where a
// notch is 120 of the browser's legacy `wheelDeltaY` units.
//
// On the alternate screen there is no history. There bb's terminal sends the
// program one arrow key per wheel event, once the event amounts to a line.

/** The fields of a DOM `WheelEvent` this reads. */
export interface WheelInput {
  deltaY: number;
  /** 0 for pixels, 1 for lines, 2 for pages. */
  deltaMode: number;
  /** Chromium's legacy delta: positive is up, 120 to a notch. */
  wheelDeltaY?: number;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
}

const DELTA_PIXEL = 0;
const DELTA_LINE = 1;
const DELTA_PAGE = 2;
const PIXELS_PER_NOTCH = 50;
const UNITS_PER_NOTCH = 120;
/** How much further the wheel goes with Alt held, as in bb's terminal. */
const FAST_SCROLL = 5;

/**
 * How many rows of history a wheel event scrolls: negative is back, into
 * older output. The result can be a fraction of a row; `WholeRows` carries
 * the remainder to the next event. `rows` is how many the terminal shows.
 */
export function historyRows(
  event: WheelInput,
  cellHeight: number,
  rows: number,
): number {
  if (!(cellHeight > 0)) return 0;
  const fast = event.altKey ? FAST_SCROLL : 1;
  // A page is a screen. Only a browser without the legacy delta gets here.
  if (event.wheelDeltaY === undefined && event.deltaMode === DELTA_PAGE) {
    return event.deltaY * rows * fast;
  }
  const notchesUp =
    event.wheelDeltaY !== undefined
      ? event.wheelDeltaY / UNITS_PER_NOTCH
      : event.deltaMode === DELTA_LINE
        ? -event.deltaY
        : -event.deltaY / 40;
  return (-notchesUp * fast * PIXELS_PER_NOTCH) / cellHeight;
}

/**
 * How many lines a wheel event amounts to on the alternate screen: negative
 * is up. Small pixel movements count for less, so a slow two-finger scroll
 * does not send a burst of keys.
 */
export function alternateScreenLines(
  event: WheelInput,
  cellHeight: number,
  rows: number,
): number {
  if (event.deltaY === 0 || event.shiftKey || !(cellHeight > 0)) return 0;
  const fast = event.altKey || event.ctrlKey ? FAST_SCROLL : 1;
  const amount = event.deltaY * fast;
  if (event.deltaMode === DELTA_PIXEL) {
    return (amount / cellHeight) * (Math.abs(event.deltaY) < 50 ? 0.3 : 1);
  }
  return event.deltaMode === DELTA_PAGE ? amount * rows : amount;
}

/** Turns a run of fractional amounts into whole rows, keeping the remainder. */
export class WholeRows {
  #partial = 0;

  /** Adds `amount` and returns the whole rows now due, toward zero. */
  take(amount: number): number {
    this.#partial += amount;
    // Adding zero turns the -0 that truncating a small negative gives into 0.
    const whole = Math.trunc(this.#partial) + 0;
    this.#partial -= whole;
    return whole;
  }

  /** Forgets the remainder, such as when the wheel changes what it does. */
  reset(): void {
    this.#partial = 0;
  }
}
