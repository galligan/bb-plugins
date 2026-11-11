/** Same-tab panels must not replace a recovery record changed since it was observed. */
export function replaceRecoveryRecord(
  key: string,
  observed: string | null | undefined,
  replacement: string | null,
) {
  const raw = sessionStorage.getItem(key);
  if (raw !== observed) return { replaced: false, raw };
  if (replacement === null) sessionStorage.removeItem(key);
  else sessionStorage.setItem(key, replacement);
  return { replaced: true, raw: replacement };
}
