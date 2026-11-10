import type { IdentityRegistry } from "./identity-registry.ts";
import type { ProjectRegistry } from "./project-registry.ts";
import type { TransmissionContext } from "./transmission-contracts.ts";
import type { AddressScope } from "./address-resolution.ts";
import { RadioError } from "./errors.ts";

export function requireChannel(
  projects: ProjectRegistry,
  channelId: string,
  scope: AddressScope,
) {
  if (
    scope.projectIds.length > 100 ||
    (scope.currentProjectId &&
      !scope.projectIds.includes(scope.currentProjectId))
  )
    throw new RadioError("forbidden", "Invalid authorized project scope.");
  const channel = projects.channel(channelId);
  if (!scope.projectIds.includes(channel.projectId))
    throw new RadioError("not_found", "Unknown or inaccessible channel.");
  return channel;
}

export function requireAuthor(
  identities: IdentityRegistry,
  context: TransmissionContext,
) {
  const actor = identities.requireActor(context.authorId);
  const caller = context.caller;
  const owns =
    caller.kind === "principal"
      ? actor.kind === "actor" &&
        actor.principalId !== null &&
        actor.principalId === caller.principalId
      : actor.id === caller.actorId && actor.kind === caller.kind;
  if (!owns)
    throw new RadioError("forbidden", "Caller cannot send as this author.");
  if (context.sessionId) {
    const session = identities.get(context.sessionId);
    if (session.actorId !== actor.id)
      throw new RadioError(
        "forbidden",
        "Acting session does not belong to this author.",
      );
  }
  return JSON.stringify(
    caller.kind === "principal"
      ? ["principal", caller.principalId, actor.id]
      : [caller.kind, actor.id],
  );
}
