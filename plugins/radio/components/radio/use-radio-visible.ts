import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}
const visible = () => document.visibilityState === "visible";

/** Radio is a navigation page; the SDK's side-panel-tab flag is false here. */
export function useRadioVisible() {
  // Mounted pages read normally; hiding the browser pauses reads and locks operator mode.
  // Navigating away unmounts the page and disposes its host-owned queries/authority.
  return useSyncExternalStore(subscribe, visible, () => false);
}
