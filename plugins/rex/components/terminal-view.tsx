// Draws one frame of a terminal as text.
//
// Each row is a line of spans in a monospace font, where a column is `1ch`
// wide. Runs marked `pinned` hold a character the font may draw at another
// width, so they are fixed to the width of their cells. This is the simplest
// renderer that shows text, its colors, and the cursor; it draws no images,
// no blinking, and no selection of its own.

import type { CSSProperties } from "react";

import type { Frame } from "../lib/frame-reader.ts";
import { cssColor, runColors, STYLE, type Run } from "../lib/runs.ts";

const FONT_PX = 12;
const LINE_PX = 16;

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
}: {
  cursor: NonNullable<Frame["cursor"]>;
  color: string;
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
  if (cursor.style === "block") {
    style.backgroundColor = color;
    style.opacity = 0.6;
  } else if (cursor.style === "bar") {
    style.borderLeft = `2px solid ${color}`;
  } else if (cursor.style === "underline") {
    style.borderBottom = `2px solid ${color}`;
  } else {
    style.border = `1px solid ${color}`;
  }
  return <div aria-hidden style={style} />;
}

export function TerminalView({ frame }: { frame: Frame }) {
  const defaults = {
    foreground: frame.foreground,
    background: frame.background,
  };
  return (
    <div
      className="min-h-0 flex-1 overflow-auto p-2"
      style={{ backgroundColor: cssColor(frame.background) }}
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
          />
        )}
      </div>
    </div>
  );
}
