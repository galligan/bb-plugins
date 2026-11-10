import { z } from "zod";
import { git } from "./process.ts";
import { rescueSchema } from "./rescue-schema.ts";
export async function listRescues(
  sourcePath: string,
  signal?: AbortSignal,
): Promise<z.infer<typeof rescueSchema>[]> {
  const result = await git(
    sourcePath,
    [
      "for-each-ref",
      "--format=%(refname)%00%(objectname)%00%(committerdate:unix)%00%(subject)",
      "refs/wt-rescue/",
    ],
    signal,
    // The project listing distinguishes Git's standard non-repository error.
    { LC_ALL: "C" },
  );
  if (result.code !== 0)
    throw new Error(`Could not list rescue refs: ${result.stderr.trim()}`);
  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref, commit, timestamp, subject] = line.split("\0");
      return rescueSchema.parse({
        ref,
        commit,
        createdAt: Number(timestamp) * 1000,
        subject,
      });
    });
}
