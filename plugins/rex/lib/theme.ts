// The default colors Rex reports for a terminal in a `theme` message.
//
// `foreground`, `background`, and `cursor` are written `RRGGBB` or `#RRGGBB`.
// `palette` lists changes to the 256-color palette as `index=RRGGBB`. A color
// that is left out is the built-in one. Colors here are packed as 0xRRGGBB.

export interface Theme {
  /** Null means the built-in color. */
  foreground: number | null;
  background: number | null;
  cursor: number | null;
  /** Palette index to color, for the entries that differ from the built-in palette. */
  palette: Map<number, number>;
}

const COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/;
const PALETTE_ENTRY_PATTERN = /^(\d{1,3})=(.*)$/;

/** Reads `RRGGBB` or `#RRGGBB`. Anything else, including empty, is null. */
export function parseColor(text: string | undefined): number | null {
  const hex = text === undefined ? undefined : COLOR_PATTERN.exec(text)?.[1];
  return hex === undefined ? null : Number.parseInt(hex, 16);
}

/** Reads a `theme` message's fields. An entry that does not parse is skipped. */
export function parseTheme(message: {
  foreground?: string;
  background?: string;
  cursor?: string;
  palette?: readonly string[] | null;
}): Theme {
  const palette = new Map<number, number>();
  for (const entry of message.palette ?? []) {
    const match = PALETTE_ENTRY_PATTERN.exec(entry);
    if (match === null) continue;
    const index = Number(match[1]);
    const color = parseColor(match[2]);
    if (index <= 255 && color !== null) palette.set(index, color);
  }
  return {
    foreground: parseColor(message.foreground),
    background: parseColor(message.background),
    cursor: parseColor(message.cursor),
    palette,
  };
}
