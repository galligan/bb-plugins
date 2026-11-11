import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const visible = () => document.visibilityState === "visible";

// Navigation pages do not have the secondary-panel tab visibility context.
// The host owns mount/unmount; this additionally pauses work when the browser hides.
export function usePageVisible() {
  return useSyncExternalStore(subscribe, visible, () => false);
}
