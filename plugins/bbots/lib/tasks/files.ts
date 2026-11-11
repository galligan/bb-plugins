import { createHash, randomUUID } from "node:crypto";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { inspectHome } from "../setup/home.ts";

const limit = 65536;
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
async function home(botId: string, path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if ((await inspectHome(botId, path)) !== "present")
    throw new Error(
      "Original bot home is missing or conflicts with its marker. Restore it; tasks.md will not be recreated in another home.",
    );
}
export async function readTasks(
  botId: string,
  path: string,
  signal?: AbortSignal,
) {
  await home(botId, path, signal);
  const filePath = join(path, "tasks.md");
  const before = await lstat(filePath).catch((error) => {
    if (error.code === "ENOENT")
      throw new Error(
        "tasks.md is missing. Restore the authoritative file; no replacement is created by reading.",
      );
    throw error;
  });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > limit ||
    before.nlink !== 1
  )
    throw new Error(
      "tasks.md must be a regular, unlinked file of at most 65,536 bytes. Preserve the file and resolve this conflict.",
    );
  const file = await open(filePath, "r");
  try {
    const actual = await file.stat();
    if (
      actual.dev !== before.dev ||
      actual.ino !== before.ino ||
      !actual.isFile()
    )
      throw new Error(
        "tasks.md changed during inspection. Read again before editing.",
      );
    const buffer = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(
        buffer,
        count,
        buffer.length - count,
        count,
      );
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > limit)
      throw new Error("tasks.md exceeds its bounded read limit.");
    const content = buffer.subarray(0, count);
    return {
      path: filePath,
      markdown: new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(content),
      hash: sha(content),
    };
  } finally {
    await file.close();
  }
}
async function locked<T>(
  botId: string,
  path: string,
  signal: AbortSignal | undefined,
  action: () => Promise<T>,
) {
  await home(botId, path, signal);
  const lockPath = join(path, ".bbots-tasks.lock");
  const lock = await open(lockPath, "wx", 0o600).catch((error) => {
    if (error.code === "EEXIST")
      throw new Error(
        "Another tasks.md edit or an interrupted lock exists. Inspect owned work before manually recovering that lock; Bots will not steal it or retry.",
      );
    throw error;
  });
  try {
    signal?.throwIfAborted();
    return await action();
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
export function initializeTasks(
  botId: string,
  path: string,
  requestId: string,
  signal?: AbortSignal,
) {
  const markdown = `<!-- bbots-tasks ${botId} ${requestId} -->\n# Tasks\n\nRecord this bot's tasks here. This file is authoritative; configured Tasks boards are never replaced by it during an outage.\n`;
  return locked(botId, path, signal, async () => {
    const filePath = join(path, "tasks.md");
    try {
      const file = await open(filePath, "wx", 0o600);
      try {
        await file.writeFile(markdown, { encoding: "utf8", signal });
        await file.sync();
      } finally {
        await file.close();
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      )
        throw error;
    }
    const current = await readTasks(botId, path, signal);
    if (current.hash !== sha(markdown))
      throw new Error(
        "Existing tasks.md differs from this exact initialization intent. Preserve it and inspect the conflict; no file was overwritten.",
      );
    return current;
  });
}
export function writeTasks(
  botId: string,
  path: string,
  expectedHash: string,
  markdown: string,
  signal?: AbortSignal,
) {
  if (Buffer.byteLength(markdown, "utf8") > limit)
    throw new Error("tasks.md exceeds its 65,536-byte limit.");
  return locked(botId, path, signal, async () => {
    const current = await readTasks(botId, path, signal);
    if (current.hash !== expectedHash)
      throw new Error(
        "tasks.md changed. Read it again before editing; nothing was overwritten.",
      );
    const temporary = join(path, `.bbots-tasks-${randomUUID()}.tmp`);
    let created = false;
    try {
      const file = await open(temporary, "wx", 0o600);
      created = true;
      try {
        await file.writeFile(markdown, { encoding: "utf8", signal });
        await file.sync();
      } finally {
        await file.close();
      }
      const latest = await readTasks(botId, path, signal);
      if (latest.hash !== expectedHash)
        throw new Error(
          "tasks.md changed during this edit. Read again; nothing was overwritten.",
        );
      signal?.throwIfAborted();
      await rename(temporary, current.path);
      created = false;
      const result = await readTasks(botId, path, signal);
      if (result.hash !== sha(markdown))
        throw new Error(
          "tasks.md changed after replacement. Inspect its actual content before another edit; Bots did not retry.",
        );
      return result;
    } finally {
      if (created) await unlink(temporary);
    }
  });
}
