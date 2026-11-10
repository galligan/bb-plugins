// Scrolling the terminal's history from the tab: what the wheel does, and the
// scrollbar that shows where the view is.
//
// Both follow bb's built-in terminal. On the normal screen the wheel moves
// the tab's own view and nothing is sent to Rex. On the alternate screen,
// where a full-screen program has no history to scroll, the wheel sends that
// program an arrow key, unless it has asked for mouse events itself.

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";

import type { Frame } from "../lib/frame-reader.ts";
import type { ScrollTo } from "../lib/ghostty.ts";
import { arrowKey } from "../lib/key-event.ts";
import type { PaneInput } from "../lib/pane-input.ts";
import {
  rowAfterDrag,
  SCROLLBAR_PX,
  sliderGeometry,
} from "../lib/scrollbar.ts";
import { alternateScreenLines, historyRows, WholeRows } from "../lib/wheel.ts";

/** How long the scrollbar stays after the view last moved. */
const LINGER_MS = 500;

/** What a wheel handler needs to know, as of the latest frame. */
interface WheelTarget {
  frame: Frame;
  cellHeight: number;
  onScroll: (to: ScrollTo) => void;
  onInput: ((input: PaneInput) => void) | null;
}

/** Handles the wheel over `element` for as long as it is mounted. */
export function useWheel(
  element: RefObject<HTMLElement | null>,
  target: WheelTarget,
): void {
  const latest = useRef(target);
  latest.current = target;

  useEffect(() => {
    const node = element.current;
    if (node === null) return;
    const history = new WholeRows();
    const lines = new WholeRows();

    const onWheel = (event: WheelEvent) => {
      const { frame, cellHeight, onScroll, onInput } = latest.current;
      // A sideways movement scrolls the element itself, which matters for a
      // pane that is wider than the panel.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const wheel = {
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        wheelDeltaY:
          "wheelDeltaY" in event && typeof event.wheelDeltaY === "number"
            ? event.wheelDeltaY
            : undefined,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
      };

      if (frame.alternateScreen) {
        history.reset();
        // A program that asked for mouse events expects wheel reports, which
        // the tab does not send. Arrow keys would be the wrong thing.
        if (frame.mouseTracking || onInput === null) return;
        event.preventDefault();
        const amount = lines.take(
          alternateScreenLines(wheel, cellHeight, frame.rows),
        );
        if (amount !== 0) {
          onInput({ type: "key", key: arrowKey(amount < 0 ? "up" : "down") });
        }
        return;
      }

      lines.reset();
      const hidden = frame.scroll.total - frame.rows;
      const rows = history.take(historyRows(wheel, cellHeight));
      const atEnd =
        rows < 0 ? frame.scroll.offset <= 0 : frame.scroll.offset >= hidden;
      // With nowhere to go, the element may scroll instead: a pane taller
      // than the panel is reached that way.
      if (hidden <= 0 || (rows !== 0 && atEnd)) return;
      event.preventDefault();
      if (rows !== 0) onScroll({ kind: "rows", rows });
    };

    // React attaches wheel listeners as passive, which cannot keep the
    // element from scrolling as well.
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [element]);
}

function sliderColor(percent: number): string {
  return `color-mix(in srgb, var(--foreground) ${percent}%, transparent)`;
}

/**
 * The terminal's scrollbar, sized and colored as bb's terminal draws its
 * own. It shows while the pointer is over the terminal or the view has just
 * moved, and fades out otherwise. The slider can be dragged.
 */
export function Scrollbar({
  frame,
  trackPx,
  inset,
  pointerInside,
  onScroll,
}: {
  frame: Frame;
  /** The height the terminal has to draw in. */
  trackPx: number;
  /** How far in from the top and right edges the track sits. */
  inset: number;
  /** Whether the pointer is over the terminal. */
  pointerInside: boolean;
  onScroll: (to: ScrollTo) => void;
}) {
  const [moved, setMoved] = useState(false);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<{ fromY: number; fromOffset: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const offset = frame.scroll.offset;
  const seen = useRef(offset);
  useEffect(() => {
    if (seen.current === offset) return;
    seen.current = offset;
    setMoved(true);
    const timer = setTimeout(() => setMoved(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [offset]);

  const extent = { ...frame.scroll, rows: frame.rows };
  const slider = sliderGeometry(extent, trackPx);
  if (slider === null) return null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // Keeps the keyboard with the terminal while its scrollbar is used.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { fromY: event.clientY, fromOffset: offset };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (start === null) return;
    onScroll({
      kind: "row",
      row: rowAfterDrag(
        extent,
        trackPx,
        start.fromOffset,
        event.clientY - start.fromY,
      ),
    });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const shown = pointerInside || moved || dragging;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        top: inset,
        right: inset,
        width: SCROLLBAR_PX,
        height: trackPx,
        opacity: shown ? 1 : 0,
        transition: shown ? "opacity 100ms linear" : "opacity 800ms linear",
        pointerEvents: shown ? "auto" : "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: slider.top,
          width: SCROLLBAR_PX,
          height: slider.height,
          backgroundColor: sliderColor(dragging ? 50 : hovered ? 40 : 20),
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}
