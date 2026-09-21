// The stack graph drawn as lanes: one node per branch, a line per column, and an
// elbow where a column closes. Mirrors how `gt ls` renders a stack in a terminal.

import type { CurrentStackOffshoot } from "@/lib/current-stack.ts";

const LANE = 14;

export interface OffshootRow {
  readonly offshoot: CurrentStackOffshoot;
  /** Columns with a line passing straight through this row. */
  readonly through: readonly number[];
  /** A branch in the same column joins this row from above. */
  readonly fromAbove: boolean;
  /** Columns that close into this row, drawn as the elbow of `◯─┘`. */
  readonly closes: readonly number[];
}

export function laneWidth(offshoots: readonly CurrentStackOffshoot[]): number {
  return Math.max(1, ...offshoots.map((offshoot) => offshoot.column)) * LANE;
}

/**
 * Works out, for each row, which columns have a line running through it and which
 * close into it. Offshoots arrive in post-order, so a branch always appears after
 * its descendants and every line runs downward to the row it joins.
 */
export function layoutOffshoots(offshoots: readonly CurrentStackOffshoot[]): OffshootRow[] {
  const indexOf = new Map(offshoots.map((offshoot, index) => [offshoot.name, index]));
  // A row whose parent is not an offshoot joins the chain branch, below every row.
  const parentRow = offshoots.map((offshoot) =>
    offshoot.parent === null ? offshoots.length : (indexOf.get(offshoot.parent) ?? offshoots.length),
  );

  return offshoots.map((offshoot, index) => {
    const through: number[] = [];
    let fromAbove = false;
    const closes: number[] = [];
    for (let other = 0; other < index; other += 1) {
      if (parentRow[other] > index) through.push(offshoots[other].column);
      if (parentRow[other] !== index) continue;
      if (offshoots[other].column === offshoot.column) fromAbove = true;
      else closes.push(offshoots[other].column);
    }
    return { offshoot, through: [...new Set(through)], fromAbove, closes };
  });
}

/**
 * The elbows on the chain branch's own row, where every column hanging off it
 * turns in and closes — the `◯─┴─┘` at the foot of a fork in `gt ls`.
 */
export function ChainJoin({
  columns,
  width,
}: {
  readonly columns: readonly number[];
  readonly width: number;
}) {
  const x = (column: number) => (column - 1) * LANE + 7;
  return (
    <svg
      viewBox={`0 0 ${width} 20`}
      width={width}
      height={20}
      className="shrink-0"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1" opacity="0.3" fill="none">
        {columns.map((column) => (
          <path key={column} d={`M${x(column)} 0 V10 H-6`} />
        ))}
      </g>
    </svg>
  );
}

export function OffshootLanes({ row, width }: { readonly row: OffshootRow; readonly width: number }) {
  const x = (column: number) => (column - 1) * LANE + 7;
  const own = x(row.offshoot.column);
  return (
    <svg
      viewBox={`0 0 ${width} 20`}
      width={width}
      height={20}
      className="shrink-0"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1" opacity="0.3" fill="none">
        {row.through.map((column) => (
          <line key={column} x1={x(column)} y1="0" x2={x(column)} y2="20" />
        ))}
        {row.fromAbove ? <line x1={own} y1="0" x2={own} y2="6.75" /> : null}
        <line x1={own} y1="13.25" x2={own} y2="20" />
        {/* the elbow: the closing column drops to this row, then turns into the node */}
        {row.closes.map((column) => (
          <path key={column} d={`M${x(column)} 0 V10 H${own + 3.25}`} />
        ))}
      </g>
      <circle
        cx={own}
        cy="10"
        r="3.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.4"
      />
    </svg>
  );
}

/** A branch on an offshoot column: its own ring, no spine of its own. */
export function OffshootNode() {
  return (
    <svg viewBox="0 0 14 20" className="h-5 w-3.5 shrink-0" aria-hidden="true">
      <circle cx="7" cy="10" r="2.75" fill="none" stroke="currentColor" strokeWidth="1.25" opacity="0.4" />
    </svg>
  );
}

/**
 * One node on the stack spine, in the icon column BB reserves for a row glyph.
 * Reads like `gt ls`: a filled node for the branch you are on, hollow for the rest,
 * joined by a continuous line so the lineage is visible rather than implied.
 */
export function LineageNode({
  first,
  last,
  current,
  passthrough = false,
  join = false,
}: {
  readonly first: boolean;
  readonly last: boolean;
  readonly current: boolean;
  readonly passthrough?: boolean;
  /** Draw the elbow that closes an offshoot column into this node, like `◯─┘`. */
  readonly join?: boolean;
}) {
  // The line stops short of each node rather than passing behind it, so a hollow
  // node reads as a ring and not as a crossed-out circle.
  return (
    <svg viewBox="0 0 14 20" className="h-5 w-3.5 shrink-0" aria-hidden="true">
      {passthrough ? (
        <line x1="7" y1="0" x2="7" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      ) : (
        <>
          {first ? null : (
            <line x1="7" y1="0" x2="7" y2="5.5" stroke="currentColor" strokeWidth="1" opacity="0.3" />
          )}
          {last ? null : (
            <line x1="7" y1="14.5" x2="7" y2="20" stroke="currentColor" strokeWidth="1" opacity="0.3" />
          )}
          {join ? (
            <path
              d="M10.25 10H14"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.3"
              fill="none"
            />
          ) : null}
          <circle
            cx="7"
            cy="10"
            r="3.25"
            fill={current ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.25"
            opacity={current ? 1 : 0.55}
          />
        </>
      )}
    </svg>
  );
}
