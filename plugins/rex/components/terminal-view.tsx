// Draws one frame of a terminal as text, and takes its input.
//
// It is made to look like bb's built-in terminal: the same theme variables
// for the default, cursor, selection and ANSI colors, the same font and cell
// size, and a blinking block cursor. Colors that come from the theme are CSS
// variable references, so they follow the app's theme without a redraw.
//
// Each row is a line of spans. Letter spacing sets every character to one
// cell's width, and runs marked `pinned` hold a character the font may draw
// at another width, so they are fixed to the width of their cells. It draws
// no images and no selection of its own.
//
// The wheel and the scrollbar move the view through the terminal's history;
// scrollback.tsx has both.
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
  type RefObject,
} from "react";

import { fitGrid } from "../lib/fit.ts";
import type { Frame } from "../lib/frame-reader.ts";
import type { ScrollTo } from "../lib/ghostty.ts";
import { keyFromDom, terminalTakesKey } from "../lib/key-event.ts";
import type { PaneInput } from "../lib/pane-input.ts";
import { SCROLLBAR_PX } from "../lib/scrollbar.ts";
import {
  cssColor,
  runColors,
  STYLE,
  textAt,
  THEME_COLOR,
  type Run,
} from "../lib/runs.ts";
import {
  FONT_FAMILY,
  FONT_PX,
  measureTerminalCell,
  readTerminalTheme,
  watchAppTheme,
  type TerminalCell,
} from "./app-theme.ts";
import { Scrollbar, useWheel } from "./scrollback.tsx";

const PADDING_PX = 8;
/** How long the panel must hold a size before the terminal is fitted to it. */
const FIT_DELAY_MS = 100;
/** bb's terminal shows its cursor for this long, then hides it as long. */
const BLINK_HALF_MS = 600;

function runStyle(run: Run, cell: TerminalCell): CSSProperties {
  const { color, background } = runColors(run);
  const style: CSSProperties = {};
  if (color !== THEME_COLOR.foreground) style.color = cssColor(color);
  if (background !== null) style.backgroundColor = cssColor(background);
  if ((run.flags & STYLE.bold) !== 0) style.fontWeight = 700;
  if ((run.flags & STYLE.italic) !== 0) style.fontStyle = "italic";
  if ((run.flags & STYLE.faint) !== 0) style.opacity = 0.5;
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
    style.width = run.cols * cell.width;
    style.height = cell.height;
    style.overflow = "hidden";
    style.verticalAlign = "top";
  }
  return style;
}

function Cursor({
  cursor,
  text,
  cell,
  focused,
}: {
  cursor: NonNullable<Frame["cursor"]>;
  /** The character the cursor is on. */
  text: string;
  cell: TerminalCell;
  focused: boolean;
}) {
  const color = cssColor(THEME_COLOR.foreground);
  const style: CSSProperties = {
    position: "absolute",
    left: cursor.x * cell.width,
    top: cursor.y * cell.height,
    width: cursor.cols * cell.width,
    height: cell.height,
    boxSizing: "border-box",
    overflow: "hidden",
    pointerEvents: "none",
    userSelect: "none",
  };
  // An outline is how a terminal shows that typing would not reach it.
  const shape = focused ? cursor.style : "hollow";
  if (shape === "block") {
    style.backgroundColor = color;
    style.color = cssColor(THEME_COLOR.background);
  } else if (shape === "bar") {
    style.borderLeft = `1px solid ${color}`;
  } else if (shape === "underline") {
    style.borderBottom = `1px solid ${color}`;
  } else {
    style.border = `1px solid ${color}`;
  }
  if (focused) {
    style.animation = `rex-cursor-blink ${2 * BLINK_HALF_MS}ms steps(1, end) infinite`;
  }
  return (
    <div aria-hidden style={style}>
      {shape === "block" ? text : ""}
    </div>
  );
}

/** The size of a cell in bb's terminal font, kept current with the theme. */
function useCellSize(): TerminalCell {
  const [cell, setCell] = useState(measureTerminalCell);
  useEffect(() => {
    const remeasure = () => {
      const next = measureTerminalCell();
      setCell((current) =>
        current.width === next.width &&
        current.height === next.height &&
        current.advance === next.advance
          ? current
          : next,
      );
    };
    // The font may still have been loading at the first measure.
    remeasure();
    return watchAppTheme(remeasure);
  }, []);
  return cell;
}

/**
 * Tells a pane the tab has claimed what the tab wants for it: the grid that
 * fits `container`, and the app's terminal colors. Both are sent again when
 * they change. Does nothing while `send` is null.
 */
function useClaim(
  container: RefObject<HTMLDivElement | null>,
  send: ((input: PaneInput) => void) | null,
  cell: TerminalCell,
) {
  useEffect(() => {
    const element = container.current;
    if (send === null || element === null) return;
    let fitted = "";
    const fit = () => {
      const grid = fitGrid({
        // The scrollbar's width is left clear, as bb's terminal leaves it.
        width: element.clientWidth - 2 * PADDING_PX - SCROLLBAR_PX,
        height: element.clientHeight - 2 * PADDING_PX,
        cellWidth: cell.width,
        cellHeight: cell.height,
      });
      if (grid === null || `${grid.cols}x${grid.rows}` === fitted) return;
      fitted = `${grid.cols}x${grid.rows}`;
      send({
        type: "resize",
        size: {
          ...grid,
          cellWidthPx: Math.max(1, Math.round(cell.width)),
          cellHeightPx: Math.max(1, Math.round(cell.height)),
        },
      });
    };
    let timer = setTimeout(fit, 0);
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(fit, FIT_DELAY_MS);
    });
    observer.observe(element);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [container, send, cell]);

  useEffect(() => {
    if (send === null) return;
    let sent = "";
    const recolor = () => {
      const theme = readTerminalTheme();
      if (theme === null || JSON.stringify(theme) === sent) return;
      sent = JSON.stringify(theme);
      send({ type: "theme", theme });
    };
    recolor();
    return watchAppTheme(recolor);
  }, [send]);
}

/** The height of `element`'s content box, kept current as it is resized. */
function useContentHeight(element: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const node = element.current;
    if (node === null) return;
    const measure = () => setHeight(node.clientHeight - 2 * PADDING_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return height;
}

export function TerminalView({
  frame,
  onInput,
  onScroll,
  claimsPane,
}: {
  frame: Frame;
  /** Null when the terminal can no longer take input. */
  onInput: ((input: PaneInput) => void) | null;
  /** Moves the tab's own view through the terminal's history. */
  onScroll: (to: ScrollTo) => void;
  /** Whether the tab fits the pane to this element and gives it bb's colors. */
  claimsPane: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [pointerInside, setPointerInside] = useState(false);
  const cell = useCellSize();
  const container = useRef<HTMLDivElement>(null);
  useClaim(container, claimsPane ? onInput : null, cell);
  useWheel(container, { frame, cellHeight: cell.height, onScroll, onInput });
  const trackPx = useContentHeight(container);

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

  const cursor = frame.cursor;
  return (
    <div
      className="relative min-h-0 flex-1 bg-sidebar"
      onPointerEnter={() => setPointerInside(true)}
      onPointerLeave={() => setPointerInside(false)}
    >
      <div
        ref={container}
        tabIndex={0}
        aria-label="Rex terminal"
        className="h-full overflow-auto text-foreground outline-none selection:bg-muted"
        style={{ padding: PADDING_PX }}
        onFocus={() => changeFocus(true)}
        onBlur={() => changeFocus(false)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      >
        <style>{"@keyframes rex-cursor-blink { 50% { opacity: 0; } }"}</style>
        <div
          style={{
            position: "relative",
            width: frame.cols * cell.width,
            height: frame.rows * cell.height,
            fontFamily: FONT_FAMILY,
            fontSize: FONT_PX,
            lineHeight: `${cell.height}px`,
            // Brings each character's advance to exactly one cell.
            letterSpacing: cell.width - cell.advance,
            fontVariantLigatures: "none",
            whiteSpace: "pre",
          }}
        >
          {frame.lines.map((runs, y) => (
            <div key={y} style={{ height: cell.height, overflow: "hidden" }}>
              {runs.map((run, index) => (
                <span key={index} style={runStyle(run, cell)}>
                  {run.text}
                </span>
              ))}
            </div>
          ))}
          {cursor !== null && (
            <Cursor
              // A new position restarts the blink, so a moving cursor stays lit.
              key={`${cursor.x},${cursor.y}`}
              cursor={cursor}
              text={textAt(frame.lines[cursor.y] ?? [], cursor.x)}
              cell={cell}
              focused={focused}
            />
          )}
        </div>
      </div>
      <Scrollbar
        frame={frame}
        trackPx={trackPx}
        inset={PADDING_PX}
        pointerInside={pointerInside}
        onScroll={onScroll}
      />
    </div>
  );
}
