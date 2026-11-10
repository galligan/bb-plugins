// Turns one terminal row's cells into the spans the tab draws.
//
// The terminal is a grid, and the tab draws it as text in a monospace font,
// where one column is `1ch` wide. That only holds for characters the font
// itself has. So printable ASCII with the same look is grouped into one run,
// and every other character gets a run of its own that the renderer pins to
// the width of its cells, which keeps the columns after it in place.

/** Bits of libghostty's GhosttyStyleFlags that the renderer draws. */
export const STYLE = {
  bold: 1 << 0,
  italic: 1 << 1,
  faint: 1 << 2,
  inverse: 1 << 4,
  invisible: 1 << 5,
  strikethrough: 1 << 6,
  overline: 1 << 7,
  /** Bits 8 to 10 hold the underline style; any of them set means underlined. */
  underline: 0b111 << 8,
} as const;

const DRAWN_FLAGS =
  STYLE.bold |
  STYLE.italic |
  STYLE.faint |
  STYLE.inverse |
  STYLE.invisible |
  STYLE.strikethrough |
  STYLE.overline |
  STYLE.underline;

// A color is one number. Up to 0xFFFFFF it is a packed 0xRRGGBB that a program
// chose outright. Above that it names a color the app's theme supplies, which
// the tab draws from bb's own CSS variables so the terminal follows the app:
// the 16 ANSI colors, and the terminal's default foreground and background.
const THEMED = 0x1000000;

/** The terminal's default colors, as the app's theme gives them. */
export const THEME_COLOR = {
  foreground: THEMED + 16,
  background: THEMED + 17,
} as const;

/** One of the 16 ANSI colors, palette indexes 0 to 15. */
export function ansiColor(index: number): number {
  return THEMED + index;
}

/** One cell of a row. A null color means the terminal's default. */
export interface Cell {
  /** The cell's grapheme, or "" for a cell with no text. */
  text: string;
  /** Columns the cell covers. 0 is the second half of a wide character. */
  width: 0 | 1 | 2;
  fg: number | null;
  bg: number | null;
  /** GhosttyStyleFlags. */
  flags: number;
}

export interface Run {
  text: string;
  /** Columns the run covers. */
  cols: number;
  /** Whether the renderer must pin the run to exactly `cols` columns. */
  pinned: boolean;
  fg: number | null;
  bg: number | null;
  flags: number;
}

function isPlainAscii(text: string): boolean {
  if (text.length !== 1) return false;
  const code = text.charCodeAt(0);
  return code >= 0x20 && code <= 0x7e;
}

/** Whether spaces in the run draw nothing: default background, no lines. */
function hasInvisibleSpaces(run: Run): boolean {
  const painted =
    STYLE.inverse | STYLE.underline | STYLE.strikethrough | STYLE.overline;
  return !run.pinned && run.bg === null && (run.flags & painted) === 0;
}

/** Groups a row's cells into runs, dropping the blank end of the row. */
export function buildRuns(cells: readonly Cell[]): Run[] {
  const runs: Run[] = [];
  let open: Run | null = null;
  for (const cell of cells) {
    if (cell.width === 0) continue;
    const text = cell.text === "" ? " " : cell.text;
    const flags = cell.flags & DRAWN_FLAGS;
    if (cell.width === 2 || !isPlainAscii(text)) {
      open = null;
      runs.push({
        text,
        cols: cell.width,
        pinned: true,
        fg: cell.fg,
        bg: cell.bg,
        flags,
      });
      continue;
    }
    if (
      open !== null &&
      open.fg === cell.fg &&
      open.bg === cell.bg &&
      open.flags === flags
    ) {
      open.text += text;
      open.cols += 1;
      continue;
    }
    open = { text, cols: 1, pinned: false, fg: cell.fg, bg: cell.bg, flags };
    runs.push(open);
  }
  // Most of a row is usually empty cells after its text. Leave them out.
  for (;;) {
    const last = runs.at(-1);
    if (last === undefined || !hasInvisibleSpaces(last)) break;
    const kept = last.text.trimEnd();
    if (kept !== "") {
      last.text = kept;
      last.cols = kept.length;
      break;
    }
    runs.pop();
  }
  return runs;
}

/**
 * The colors to draw a run in.
 *
 * `background` is null when the run has none of its own, so the terminal's
 * background shows through. Bold text in one of the first eight ANSI colors
 * is drawn in its bright counterpart, as bb's built-in terminal draws it.
 */
export function runColors(run: Pick<Run, "fg" | "bg" | "flags">): {
  color: number;
  background: number | null;
} {
  const bold = (run.flags & STYLE.bold) !== 0;
  const own =
    bold && run.fg !== null && run.fg >= THEMED && run.fg < THEMED + 8
      ? run.fg + 8
      : run.fg;
  const inverse = (run.flags & STYLE.inverse) !== 0;
  const background = inverse ? (own ?? THEME_COLOR.foreground) : run.bg;
  const color = inverse
    ? (run.bg ?? THEME_COLOR.background)
    : (own ?? THEME_COLOR.foreground);
  if ((run.flags & STYLE.invisible) !== 0) {
    return { color: background ?? THEME_COLOR.background, background };
  }
  return { color, background };
}

/**
 * A color as CSS. Theme colors are references to bb's variables, the ones its
 * built-in terminal reads, so they change with the app's theme on their own.
 */
export function cssColor(color: number): string {
  if (color === THEME_COLOR.foreground) return "var(--foreground)";
  if (color === THEME_COLOR.background) return "var(--sidebar)";
  if (color >= THEMED) return `var(--ansi-${color - THEMED})`;
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** The text of the cell at column `col` of a row, or "" for an empty cell. */
export function textAt(runs: readonly Run[], col: number): string {
  let start = 0;
  for (const run of runs) {
    if (col < start + run.cols) {
      return run.pinned ? run.text : (run.text[col - start] ?? "");
    }
    start += run.cols;
  }
  return "";
}
