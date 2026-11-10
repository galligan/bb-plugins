// The host renders headerContent separately from the panel. Share only its
// refresh action and busy state here; the panel still owns its data and polling.
const actions = new Set<() => Promise<void>>();
const listeners = new Set<() => void>();
let pending = 0;
const notify = () => listeners.forEach((listener) => listener());

export function connectRefresh(action: () => Promise<void>) {
  actions.add(action);
  return () => {
    actions.delete(action);
  };
}
export async function refreshWorktrees() {
  await Promise.all([...actions].map((action) => action()));
}
export function beginRefresh() {
  pending++;
  notify();
  return () => {
    pending--;
    notify();
  };
}
export const isRefreshing = () => pending > 0;
export function subscribeRefresh(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
