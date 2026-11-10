// What the tab takes from bb's own appearance: the terminal colors of the
// app's theme, and the size of a cell in its terminal font.
//
// The tab draws theme colors by referring to bb's CSS variables, so drawing
// needs nothing from here. This reads the variables' values for the two
// things CSS cannot do: tell Rex the colors, and lay the grid out in pixels.

import { cellSize } from "../lib/fit.ts";
import type { TerminalTheme } from "../lib/pane-input.ts";

/** bb's terminal font size, in CSS pixels. */
export const FONT_PX = 12;
/** The variable bb's built-in terminal takes its font family from. */
export const FONT_FAMILY = "var(--font-terminal)";
/** One terminal cell, and how far the font itself advances per character. */
export interface TerminalCell {
  width: number;
  height: number;
  advance: number;
}

/** The cell bb's terminal font gives when a font cannot be measured. */
const FALLBACK_CELL: TerminalCell = { width: 7, height: 12, advance: 7 };

const THEME_CHECK_DELAY_MS = 150;

function rootVariable(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** The size of one cell in bb's terminal font. */
export function measureTerminalCell(): TerminalCell {
  const context = document.createElement("canvas").getContext("2d");
  const family = rootVariable("--font-terminal");
  if (context === null || family === "") return FALLBACK_CELL;
  context.font = `${FONT_PX}px ${family}`;
  const metrics = context.measureText("W");
  const cell = cellSize({
    advance: metrics.width,
    ascent: metrics.fontBoundingBoxAscent,
    descent: metrics.fontBoundingBoxDescent,
    devicePixelRatio: window.devicePixelRatio,
  });
  return cell === null ? FALLBACK_CELL : { ...cell, advance: metrics.width };
}

/**
 * bb's terminal colors as `rrggbb`, or null if any could not be read. They
 * are the variables bb's built-in terminal reads: `--sidebar` behind the
 * text, `--foreground` for text and cursor, and `--ansi-0` to `--ansi-15`.
 */
export function readTerminalTheme(): TerminalTheme | null {
  const context = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (context === null) return null;
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);

  // A theme may write a color in any CSS form, such as oklch or color-mix.
  // The browser resolves the form, and painting one pixel gives its sRGB.
  const resolve = (name: string): string | null => {
    const value = rootVariable(name);
    if (value === "") return null;
    probe.style.color = "";
    probe.style.color = value;
    const color = getComputedStyle(probe).color;
    // An assignment the canvas cannot parse leaves the fill unchanged, so
    // try from two different fills and take a color only if both agree.
    const painted = ["#000000", "#ffffff"].map((before) => {
      context.fillStyle = before;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red = 0, green = 0, blue = 0] = context.getImageData(
        0,
        0,
        1,
        1,
      ).data;
      return ((red << 16) | (green << 8) | blue).toString(16).padStart(6, "0");
    });
    return painted[0] !== undefined && painted[0] === painted[1]
      ? painted[0]
      : null;
  };

  try {
    const foreground = resolve("--foreground");
    const background = resolve("--sidebar");
    const ansi = Array.from({ length: 16 }, (_, index) =>
      resolve(`--ansi-${index}`),
    ).filter((color) => color !== null);
    if (foreground === null || background === null || ansi.length !== 16) {
      return null;
    }
    return { foreground, background, cursor: foreground, ansi };
  } finally {
    probe.remove();
  }
}

/**
 * Calls `onChange` when the app's theme may have changed: light or dark was
 * switched, another theme was chosen, or a theme's stylesheet was edited.
 * It can be called when nothing the caller reads has changed.
 */
export function watchAppTheme(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, THEME_CHECK_DELAY_MS);
  };
  // bb switches themes by changing the root element's classes and the
  // contents of a stylesheet in the head.
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true });
  observer.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  scheme.addEventListener("change", schedule);
  document.fonts.addEventListener("loadingdone", schedule);
  return () => {
    clearTimeout(timer);
    observer.disconnect();
    scheme.removeEventListener("change", schedule);
    document.fonts.removeEventListener("loadingdone", schedule);
  };
}
