import type { RadioStore } from "./storage.ts";
import type { AddressToken } from "./body-parser.ts";
import { RadioError } from "./errors.ts";

/** Adapter-authorized project access, separate from claimed metadata. */
export interface AddressScope {
  projectIds: readonly string[];
  currentProjectId?: string;
}

export function resolveAddress(
  store: Pick<RadioStore, "stationId" | "identities" | "projects" | "handles">,
  token: AddressToken,
  scope: AddressScope,
) {
  if (scope.projectIds.length > 100)
    throw new RadioError(
      "invalid_input",
      "Resolve at most 100 accessible projects at once.",
    );
  const allowed = new Set(scope.projectIds);
  if (scope.currentProjectId && !allowed.has(scope.currentProjectId))
    throw new RadioError("forbidden", "Current project is not accessible.");
  if (token.kind === "human") {
    const human = store.identities.human();
    return {
      token,
      stationId: store.stationId,
      targetId: human.id,
      targetKind: human.kind,
    };
  }
  const projects = [...allowed].flatMap((id) => {
    try {
      return [store.projects.get(id)];
    } catch (error) {
      if (error instanceof RadioError && error.code === "not_found") return [];
      throw error;
    }
  });
  const qualified = token.project
    ? projects.find((project) => project.name === token.project)
    : undefined;
  if (token.project && !qualified)
    throw new RadioError(
      "not_found",
      "Unknown or inaccessible project qualifier.",
    );
  if (token.kind !== "participant") {
    const channel = store.projects.resolvePath(
      `${qualified!.name}${token.subchannel ? `/${token.subchannel}` : ""}`,
    );
    return {
      token,
      stationId: store.stationId,
      targetId: channel.id,
      targetKind: "channel" as const,
    };
  }
  const candidates = qualified
    ? [qualified]
    : scope.currentProjectId
      ? projects.filter((project) => project.id === scope.currentProjectId)
      : projects;
  const matches = candidates.flatMap((project) => {
    const handle = store.handles.lookup(project.id, token.name);
    return handle ? [{ project, handle }] : [];
  });
  if (!matches.length)
    throw new RadioError(
      "not_found",
      "Unknown handle in the selected project scope.",
    );
  if (matches.length > 1)
    throw new RadioError(
      "ambiguous",
      "Qualify this handle with its project.",
      matches
        .map(({ project, handle }) => `@${project.name}:${handle.name}`)
        .sort(),
    );
  const match = matches[0]!;
  const participant = store.identities.get(match.handle.targetId);
  return {
    token,
    stationId: store.stationId,
    targetId: participant.id,
    targetKind: participant.kind,
  };
}
