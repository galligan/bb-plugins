import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const remote = "https://github.com/get-bb/bb.git";
const sources = ["docs", "plugins/bb-guide/skills", "LICENSE"];

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function files(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Unexpected symlink: ${relative}`);
    return entry.isDirectory()
      ? files(path.join(directory, entry.name), relative)
      : [relative];
  });
}

// Preserve the upstream layout so mirrored references keep their original links.
// Links outside the mirror point to the same upstream commit, never moving main.
export function rewriteLinks(markdown, source, mirrored, commit) {
  function destination(url) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return url;
    const [, pathname, suffix] = url.match(/^([^?#]*)(.*)$/);
    if (!pathname) return url;
    const target = path.posix.normalize(
      path.posix.join(path.posix.dirname(source), pathname),
    );
    if (
      mirrored.has(target) ||
      [...mirrored].some((file) => file.startsWith(`${target}/`))
    )
      return url;
    // Root-relative web routes are not repository-relative files.
    if (pathname.startsWith("/") || target.startsWith("../")) return url;
    return `https://github.com/get-bb/bb/blob/${commit}/${target}${suffix}`;
  }
  // Skip fenced and inline code. Handle inline links/images and reference definitions.
  return markdown.replace(
    /(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[^\n]*(?:\n|$))|(`+)[^\n]*?\3|(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^\s)]+)([^\n)]*\))|(^ {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]+>|\S+)/gm,
    (
      match,
      fence,
      delimiter,
      inline,
      start,
      url,
      end,
      reference,
      referenceUrl,
    ) => {
      if (fence || inline) return match;
      const value = url ?? referenceUrl;
      const angle = value.startsWith("<");
      const rewritten = destination(angle ? value.slice(1, -1) : value);
      return `${start ?? reference}${angle ? `<${rewritten}>` : rewritten}${end ?? ""}`;
    },
  );
}

export function buildSnapshot(checkout, destination, commit, branch) {
  mkdirSync(destination);
  for (const source of sources) {
    cpSync(path.join(checkout, source), path.join(destination, source), {
      recursive: true,
      dereference: false,
    });
  }
  const mirrored = new Set(files(destination));
  for (const file of mirrored) {
    if (!file.endsWith(".md")) continue;
    const target = path.join(destination, file);
    writeFileSync(
      target,
      rewriteLinks(readFileSync(target, "utf8"), file, mirrored, commit),
    );
  }
  writeFileSync(
    path.join(destination, "sync.json"),
    `${JSON.stringify({ repository: remote, branch, commit, fetchedAt: new Date().toISOString(), sources }, null, 2)}\n`,
  );
  return mirrored.size;
}

export function syncDocs(root) {
  const directory = path.join(root, "docs/bb");
  mkdirSync(directory, { recursive: true });
  const work = path.join(directory, ".sync");
  // Exclusive ownership keeps concurrent refreshes from replacing each other's copy.
  mkdirSync(work);
  const current = path.join(directory, "upstream");
  const previous = path.join(work, "previous");
  try {
    const checkout = path.join(work, "checkout");
    git(
      root,
      "clone",
      "--depth=1",
      "--filter=blob:none",
      "--sparse",
      remote,
      checkout,
    );
    git(checkout, "sparse-checkout", "set", "docs", "plugins/bb-guide/skills");
    const commit = git(checkout, "rev-parse", "HEAD");
    const branch = git(checkout, "branch", "--show-current");
    const staged = path.join(work, "snapshot");
    const count = buildSnapshot(checkout, staged, commit, branch);
    if (existsSync(current)) renameSync(current, previous);
    try {
      renameSync(staged, current);
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, current);
      throw error;
    }
    console.log(`BB docs: ${count} files from ${branch}@${commit}\n${current}`);
  } finally {
    // If rollback itself failed, leave the backup for manual recovery.
    if (!existsSync(previous) || existsSync(current))
      rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    if (process.argv.length !== 2) throw new Error("Usage: bun run docs:bb");
    syncDocs(path.resolve(import.meta.dirname, ".."));
  } catch (error) {
    console.error(
      `BB docs refresh failed; no fresh snapshot was published: ${error.message}`,
    );
    process.exitCode = 1;
  }
}
