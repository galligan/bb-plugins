// Stack-position artwork: three stacked plates, the one you are on at full
// opacity and the rest at 0.4.
//
// Traced from Graphite's own stack indicator in the app.graphite.com stack list
// (read 2026-09-18), where it sits beside an "N/M" position label. Graphite ships
// exactly three variants and moves the emphasis by opacity rather than by colour,
// so the mark inherits `currentColor` and stays correct in every theme.
//
// This is Graphite's brand artwork. See docs/decisions for the reuse question.

export type StackPosition = "top" | "middle" | "bottom";

export const STACK_POSITIONS: readonly StackPosition[] = ["top", "middle", "bottom"];

/** The three plates, top to bottom. Identical in every variant; only opacity moves. */
export const STACK_LAYER_PATHS: Readonly<Record<StackPosition, string>> = {
  top:
    "M7.55279 1.22361C7.83431 1.08284 8.16569 1.08284 8.44721 1.22361L14.1056 4.05279" +
    "C14.4741 4.23705 14.4741 4.76295 14.1056 4.94721L8.44721 7.77639C8.16569 7.91716" +
    " 7.83431 7.91716 7.55279 7.77639L1.89443 4.94721C1.5259 4.76295 1.5259 4.23705" +
    " 1.89443 4.05279L7.55279 1.22361Z",
  middle:
    "M3.00019 7L1.89456 7.55282C1.52603 7.73708 1.52603 8.26298 1.89456 8.44725L7.55292" +
    " 11.2764C7.83444 11.4172 8.16582 11.4172 8.44734 11.2764L14.1057 8.44725C14.4742" +
    " 8.26298 14.4742 7.73708 14.1057 7.55282L13.0002 7.00006L8.44747 9.27643C8.16595" +
    " 9.41719 7.83457 9.41719 7.55305 9.27643L3.00019 7Z",
  bottom:
    "M3.00007 10.4999L1.89443 11.0528C1.5259 11.237 1.5259 11.7629 1.89443 11.9472" +
    "L7.55279 14.7764C7.83431 14.9171 8.16569 14.9171 8.44721 14.7764L14.1056 11.9472" +
    "C14.4741 11.7629 14.4741 11.237 14.1056 11.0528L13.0001 10.5L8.44734 12.7764" +
    "C8.16582 12.9171 7.83444 12.9171 7.55292 12.7764L3.00007 10.4999Z",
};

/**
 * Graphite draws the inactive plates at 0.4, where the mark is a primary glyph at
 * full colour. Ours sits in muted composer chrome beside Hugeicons strokes, and a
 * filled mark carries far more ink than a stroked one — 0.4 read as a dark block
 * next to BB's own icons. 0.25 matches their weight and keeps the active plate clear.
 */
export const STACK_DIM_OPACITY = 0.25;

/** Accessible label for a branch's place in its stack. */
export function stackPositionLabel(position: StackPosition): string {
  return `${position} of stack`;
}

/** Markup for contexts with no React — previews, and any future text renderer. */
export function stackPositionSvg(position: StackPosition, size = 16): string {
  const layers = STACK_POSITIONS.map((layer) => {
    const opacity = layer === position ? 1 : STACK_DIM_OPACITY;
    return `<path opacity="${opacity}" d="${STACK_LAYER_PATHS[layer]}"/>`;
  }).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${layers}</svg>`
  );
}
