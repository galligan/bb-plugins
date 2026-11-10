import { posix, win32 } from "node:path";
import type { BbPluginApi, PluginCliContext } from "@get-bb/plugin-sdk";
import { LIMITS, ValidationError } from "./json.ts";

/** Caller files belong to the selected host, even when the plugin runs elsewhere. */
export async function readCallerYaml(
  bb: BbPluginApi,
  file: string,
  machine: string | undefined,
  ctx: PluginCliContext,
): Promise<string> {
  let hostId: string | undefined;
  if (!machine && ctx.threadId) {
    const thread = await bb.sdk.threads.get({
      threadId: ctx.threadId,
      signal: ctx.signal,
    });
    if (!thread.environmentId) throw new ValidationError("missing_environment");
    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
      signal: ctx.signal,
    });
    hostId = environment.hostId ?? undefined;
  }
  if (!machine && !hostId) throw new ValidationError("machine_required");
  const hosts = await bb.sdk.hosts.list({ signal: ctx.signal });
  const matches = hosts.filter((host) =>
    machine ? host.id === machine || host.name === machine : host.id === hostId,
  );
  if (matches.length !== 1 || matches[0]!.status !== "connected")
    throw new ValidationError("host_unavailable");
  const paths =
    /^[A-Za-z]:[\\/]|^\\\\/.test(file) || /^[A-Za-z]:[\\/]/.test(ctx.cwd ?? "")
      ? win32
      : posix;
  if (
    !paths.isAbsolute(file) &&
    (machine || !ctx.cwd || !paths.isAbsolute(ctx.cwd))
  )
    throw new ValidationError("absolute_path_required");
  const path = paths.isAbsolute(file)
    ? paths.normalize(file)
    : paths.resolve(ctx.cwd!, file);
  const result = await bb.sdk.files.read({
    hostId: matches[0]!.id,
    path,
    signal: ctx.signal,
  });
  if (
    result.contentEncoding !== "utf8" ||
    result.sizeBytes > LIMITS.definitionBytes ||
    Buffer.byteLength(result.content, "utf8") > LIMITS.definitionBytes
  )
    throw new ValidationError("definition_bytes");
  return result.content;
}
