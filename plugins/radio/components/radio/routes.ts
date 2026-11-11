export interface RadioRoute {
  projectId: string;
  kind?: "channel" | "transmission" | "dispatch";
  id?: string;
  revision?: number;
}
export function readRoute(subPath: string): RadioRoute | null {
  try {
    const parts = subPath.split("/").map(decodeURIComponent);
    if (
      parts.some((part) => !part || part.length > 256 || part.includes("/")) ||
      parts.length > 4
    )
      return null;
    if (parts.length === 1) return { projectId: parts[0] };
    const [projectId, kind, id, revision] = parts;
    if (
      !id ||
      id.length > 256 ||
      !["channel", "transmission", "dispatch"].includes(kind!)
    )
      return null;
    if (
      revision !== undefined &&
      (kind !== "dispatch" ||
        !/^[1-9]\d*$/.test(revision) ||
        !Number.isSafeInteger(Number(revision)))
    )
      return null;
    return {
      projectId: projectId!,
      kind: kind as RadioRoute["kind"],
      id,
      revision: revision ? Number(revision) : undefined,
    };
  } catch {
    return null;
  }
}
export function routePath(route: RadioRoute): string {
  return [
    route.projectId,
    ...(route.kind && route.id
      ? [
          route.kind,
          route.id,
          ...(route.revision ? [String(route.revision)] : []),
        ]
      : []),
  ].join("/");
}
