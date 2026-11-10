// How many terminal columns and rows fit in the tab's panel.

/** Below this the panel is hidden or collapsed, not a size to ask for. */
const MIN_COLS = 10;
const MIN_ROWS = 2;
const MAX_COLS = 500;
const MAX_ROWS = 200;

/**
 * The largest grid of whole cells that fits in `width` by `height` pixels.
 *
 * Returns null when the space cannot be measured or is too small to be a real
 * terminal, such as while the tab is hidden. No size is requested then.
 */
export function fitGrid(space: {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
}): { cols: number; rows: number } | null {
  const { width, height, cellWidth, cellHeight } = space;
  if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
  const cols = Math.floor(width / cellWidth);
  const rows = Math.floor(height / cellHeight);
  if (!(cols >= MIN_COLS) || !(rows >= MIN_ROWS)) return null;
  return { cols: Math.min(cols, MAX_COLS), rows: Math.min(rows, MAX_ROWS) };
}

/**
 * The size of one terminal cell in CSS pixels, from the font's metrics.
 *
 * This is how bb's built-in terminal sizes its cells: the character's advance
 * rounded down to a whole device pixel, and the font's height rounded up to
 * one, with no extra line spacing.
 */
export function cellSize(font: {
  /** How far one character advances, in CSS pixels. */
  advance: number;
  ascent: number;
  descent: number;
  devicePixelRatio: number;
}): { width: number; height: number } | null {
  const ratio = font.devicePixelRatio > 0 ? font.devicePixelRatio : 1;
  const width = Math.floor(font.advance * ratio) / ratio;
  const height = Math.ceil((font.ascent + font.descent) * ratio) / ratio;
  return width > 0 && height > 0 ? { width, height } : null;
}
