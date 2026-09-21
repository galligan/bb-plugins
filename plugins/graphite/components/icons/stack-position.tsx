// React wrappers for the stack-position artwork. Register these with
// `app.experimental_icons.register` so any BB surface can name them.

import {
  STACK_DIM_OPACITY,
  STACK_LAYER_PATHS,
  STACK_POSITIONS,
  stackPositionLabel,
  type StackPosition,
} from "./stack-position.ts";

export interface StackPositionIconProps {
  readonly position: StackPosition;
  /** Host sizing. The mark scales from its 16-unit viewBox. */
  readonly className?: string;
  /** Omit to render decoratively; the surrounding control carries the label. */
  readonly labelled?: boolean;
}

export function StackPositionIcon({
  position,
  className,
  labelled = false,
}: StackPositionIconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-label={labelled ? stackPositionLabel(position) : undefined}
    >
      {STACK_POSITIONS.map((layer) => (
        <path
          key={layer}
          d={STACK_LAYER_PATHS[layer]}
          opacity={layer === position ? 1 : STACK_DIM_OPACITY}
        />
      ))}
    </svg>
  );
}

export function StackTopIcon({ className }: { readonly className?: string }) {
  return <StackPositionIcon position="top" className={className} />;
}

export function StackMiddleIcon({
  className,
}: {
  readonly className?: string;
}) {
  return <StackPositionIcon position="middle" className={className} />;
}

export function StackBottomIcon({
  className,
}: {
  readonly className?: string;
}) {
  return <StackPositionIcon position="bottom" className={className} />;
}

/** Icon names to register. Namespaced so they cannot collide with a host icon. */
export const STACK_ICON_REGISTRATIONS = [
  { name: "graphite-stack-top", component: StackTopIcon },
  { name: "graphite-stack-middle", component: StackMiddleIcon },
  { name: "graphite-stack-bottom", component: StackBottomIcon },
] as const;

export type { StackPosition } from "./stack-position.ts";
