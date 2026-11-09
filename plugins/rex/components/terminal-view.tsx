// Draws one frame of a terminal as text, and takes its input.
//
// Each row is a line of spans in a monospace font, where a column is `1ch`
// wide. Runs marked `pinned` hold a character the font may draw at another
// width, so they are fixed to the width of their cells. This is the simplest
// renderer that shows text, its colors, and the cursor; it draws no images,
// no blinking, and no selection of its own.
//
// The terminal takes keys only while it has focus, which a click gives it.
// Command combinations are left to the app. Copy works on the text as the
// browser selects it, and paste arrives as a clipboard event.

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { fitGrid } from "../lib/fit.ts";
import type { Frame } from "../lib/frame-reader.ts";
import { keyFromDom, terminalTakesKey } from "../lib/key-event.ts";
import type { PaneInput } from "../lib/pane-input.ts";
import { cssColor, runColors, STYLE, type Run } from "../lib/runs.ts";

const FONT_PX = 12;
const LINE_PX = 16;
const PADDING_PX = 8;
/** Characters in the hidden probe that measures how wide one column is. */
const PROBE_COLS = 50;
/** How long the panel must hold a size before the terminal is fitted to it. */
const FIT_DELAY_MS = 100;

interface Defaults {
  foreground: number;
  background: number;
}

function runStyle(run: Run, defaults: Defaults): CSSProperties {
  const { color, background } = runColors(run, defaults);
  const style: CSSProperties = {};
  if (color !== defaults.foreground) style.color = cssColor(color);
  if (background !== null) style.backgroundColor = cssColor(background);
  if ((run.flags & STYLE.bold) !== 0) style.fontWeight = 700;
  if ((run.flags & STYLE.italic) !== 0) style.fontStyle = "italic";
  if ((run.flags & STYLE.faint) !== 0) style.opacity = 0.6;
  const lines = [
    (run.flags & STYLE.underline) !== 0 ? "underline" : "",
    (run.flags & STYLE.strikethrough) !== 0 ? "line-through" : "",
    (run.flags & STYLE.overline) !== 0 ? "overline" : "",
  ]
    .filter((line) => line !== "")
    .join(" ");
  if (lines !== "") style.textDecorationLine = lines;
  if (run.pinned) {
    style.display = "inline-block";
    style.width = `${run.cols}ch`;
    style.height = LINE_PX;
    style.overflow = "hidden";
    style.verticalAlign = "top";
  }
  return style;
}

function Cursor({
  cursor,
  color,
  focused,
}: {
  cursor: NonNullable<Frame["cursor"]>;
  color: string;
  focused: boolean;
}) {
  const style: CSSProperties = {
    position: "absolute",
    left: `${cursor.x}ch`,
    top: cursor.y * LINE_PX,
    width: `${cursor.cols}ch`,
    height: LINE_PX,
    boxSizing: "border-box",
    pointerEvents: "none",
  };
  // An outline is how a terminal shows that typing would not reach it.
  const shape = focused ? cursor.style : "hollow";
  if (shape === "block") {
    style.backgroundColor = color;
    style.opacity = 0.6;
  } else if (shape === "bar") {
    style.borderLeft = `2px solid ${color}`;
  } else if (shape === "underline") {
    style.borderBottom = `2px solid ${color}`;
  } else {
    style.border = `1px solid ${color}`;
  }
  return <div aria-hidden style={style} />;
}

/**
 * Reports the grid that fits the element to `onFit`, now and whenever the
 * element changes size. Does nothing while `onFit` is null.
 */
function useFit(onFit: ((grid: PaneInput) => void) | null) {
  const container = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const element = container.current;
    const ruler = probe.current;
    if (onFit === null || element === null || ruler === null) return;
    let reported = "";
    const report = () => {
      const cellWidth = ruler.getBoundingClientRect().width / PROBE_COLS;
      const grid = fitGrid({
        width: element.clientWidth - 2 * PADDING_PX,
        height: element.clientHeight - 2 * PADDING_PX,
        cellWidth,
        cellHeight: LINE_PX,
      });
      if (grid === null || `${grid.cols}x${grid.rows}` === reported) return;
      reported = `${grid.cols}x${grid.rows}`;
      onFit({
        type: "resize",
        size: {
          ...grid,
          cellWidthPx: Math.max(1, Math.round(cellWidth)),
          cellHeightPx: LINE_PX,
        },
      });
    };
    let timer = setTimeout(report, 0);
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(report, FIT_DELAY_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [onFit]);

  return { container, probe };
}

export function TerminalView({
  frame,
  onInput,
  fitsPanel,
}: {
  frame: Frame;
  /** Null when the terminal can no longer take input. */
  onInput: ((input: PaneInput) => void) | null;
  /** Whether to ask for the terminal to be resized to fit this element. */
  fitsPanel: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const { container, probe } = useFit(fitsPanel ? onInput : null);
  const defaults = {
    foreground: frame.foreground,
    background: frame.background,
  };

  const changeFocus = (next: boolean) => {
    setFocused(next);
    onInput?.({ type: "focus", focused: next });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (onInput === null || !terminalTakesKey(event)) return;
    // The key is the terminal's: keep it from scrolling the panel, moving
    // focus, or reaching the app's own shortcuts.
    event.preventDefault();
    event.stopPropagation();
    const key = keyFromDom({
      code: event.code,
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      isComposing: event.nativeEvent.isComposing,
      capsLock: event.getModifierState("CapsLock"),
      numLock: event.getModifierState("NumLock"),
    });
    if (key !== null) onInput({ type: "key", key });
  };
  const onPaste = (event: ClipboardEvent) => {
    if (onInput === null) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (text !== "") onInput({ type: "paste", text });
  };

  return (
    <div
      ref={container}
      tabIndex={0}
      aria-label="Rex terminal"
      className="min-h-0 flex-1 overflow-auto outline-none focus:ring-1 focus:ring-inset focus:ring-ring"
      style={{
        padding: PADDING_PX,
        backgroundColor: cssColor(frame.background),
      }}
      onFocus={() => changeFocus(true)}
      onBlur={() => changeFocus(false)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
    >
      <div
        className="font-mono"
        style={{
          position: "relative",
          width: `${frame.cols}ch`,
          height: frame.rows * LINE_PX,
          fontSize: FONT_PX,
          lineHeight: `${LINE_PX}px`,
          fontVariantLigatures: "none",
          whiteSpace: "pre",
          color: cssColor(frame.foreground),
        }}
      >
        <span
          ref={probe}
          aria-hidden
          style={{ position: "absolute", visibility: "hidden" }}
        >
          {"0".repeat(PROBE_COLS)}
        </span>
        {frame.lines.map((runs, y) => (
          <div key={y} style={{ height: LINE_PX, overflow: "hidden" }}>
            {runs.map((run, index) => (
              <span key={index} style={runStyle(run, defaults)}>
                {run.text}
              </span>
            ))}
          </div>
        ))}
        {frame.cursor !== null && (
          <Cursor
            cursor={frame.cursor}
            color={cssColor(frame.cursorColor ?? frame.foreground)}
            focused={focused}
          />
        )}
      </div>
    </div>
  );
}
