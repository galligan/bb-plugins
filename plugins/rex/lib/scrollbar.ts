// Where the scrollbar's slider sits, for a terminal scrolled part-way through
// its history. Sized as bb's built-in terminal sizes its own.

/** bb's terminal reserves this much width for its scrollbar. */
export const SCROLLBAR_PX = 14;
/** The slider is never shorter than this, however long the history. */
const MIN_SLIDER_PX = 20;

export interface ScrollExtent {
  /** All the terminal's rows, history included. */
  total: number;
  /** The first row shown. */
  offset: number;
  /** How many rows are shown. */
  rows: number;
}

/**
 * The slider's position and height in a track `trackPx` tall, or null when
 * there is nothing to scroll.
 */
export function sliderGeometry(
  extent: ScrollExtent,
  trackPx: number,
): { top: number; height: number } | null {
  const hidden = extent.total - extent.rows;
  if (!(hidden > 0) || !(trackPx > 0)) return null;
  const height = Math.min(
    trackPx,
    Math.max(MIN_SLIDER_PX, Math.round((trackPx * extent.rows) / extent.total)),
  );
  const offset = Math.min(Math.max(extent.offset, 0), hidden);
  return { top: Math.round(((trackPx - height) * offset) / hidden), height };
}

/**
 * The first row to show after the slider has been dragged `dragPx` from
 * where it was when the terminal showed row `startOffset` first.
 */
export function rowAfterDrag(
  extent: ScrollExtent,
  trackPx: number,
  startOffset: number,
  dragPx: number,
): number {
  const slider = sliderGeometry(extent, trackPx);
  const hidden = extent.total - extent.rows;
  if (slider === null || trackPx <= slider.height) return startOffset;
  const row = startOffset + (dragPx * hidden) / (trackPx - slider.height);
  return Math.round(Math.min(Math.max(row, 0), hidden));
}
