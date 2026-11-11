import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, dirname, relative, sep } from "node:path";

const marker = ".bbots-home.json";
const missing = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

async function assertOutsideRepository(path: string) {
  let current = path;
  while (true) {
    try {
      await lstat(join(current, ".git"));
      throw new Error("Choose a bot home base outside Git repositories.");
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export async function inspectHome(
  botId: string,
  path: string,
): Promise<"present" | "missing" | "conflict"> {
  if (!isAbsolute(path)) return "conflict";
  try {
    const stat = await lstat(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(path)) !== resolve(path)
    )
      return "conflict";
    const markerPath = join(path, marker);
    if (
      !(await lstat(markerPath)).isFile() ||
      (await lstat(markerPath)).size > 1024 ||
      (await lstat(markerPath)).isSymbolicLink()
    )
      return "conflict";
    const value = JSON.parse(await readFile(markerPath, "utf8"));
    return value?.version === 1 && value?.botId === botId
      ? "present"
      : "conflict";
  } catch (error) {
    if (missing(error)) {
      try {
        await lstat(path);
        return "conflict";
      } catch (pathError) {
        if (missing(pathError)) return "missing";
        throw pathError;
      }
    }
    if (error instanceof SyntaxError) return "conflict";
    throw error;
  }
}

async function outsideData(path: string, directory?: string) {
  if (!directory) return;
  const root = await realpath(directory).catch(() => resolve(directory));
  const child = relative(root, path);
  if (
    child === "" ||
    (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  )
    throw new Error(
      "Bot homes must live outside the plugin-owned daemon data directory.",
    );
}

export async function prepareHome(
  botId: string,
  base = join(homedir(), ".bb-bots"),
  signal?: AbortSignal,
  dataDirectory?: string,
) {
  if (!/^bot_[a-f0-9-]{36}$/.test(botId) || !isAbsolute(base))
    throw new Error("A valid bot ID and absolute home base are required.");
  signal?.throwIfAborted();
  await outsideData(resolve(base), dataDirectory);
  await assertOutsideRepository(resolve(base));
  await mkdir(base, { recursive: true });
  const root = await realpath(base);
  await outsideData(root, dataDirectory);
  await assertOutsideRepository(root);
  const path = join(root, botId);
  const state = await inspectHome(botId, path);
  if (state === "present") return { path, status: "present" as const };
  if (state === "conflict")
    throw new Error(
      "Home path already exists without the matching Bots marker. Preserve it and resolve the conflict before retrying.",
    );
  signal?.throwIfAborted();
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "EEXIST" &&
      (await inspectHome(botId, path)) === "present"
    )
      return { path, status: "present" as const };
    throw error;
  }
  // A crash before the exclusive marker write leaves a visible conflict, never permission to replace files.
  await writeFile(
    join(path, marker),
    JSON.stringify({ version: 1, botId }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return { path, status: "created" as const };
}
