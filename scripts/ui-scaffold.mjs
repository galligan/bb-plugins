import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  realpath,
  lstat,
} from "node:fs/promises";
import {
  dirname,
  resolve,
  relative,
  join,
  isAbsolute,
  basename,
} from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(
  new URL("../scaffolds/nav-panel/", import.meta.url),
);
const recordName = "scaffold.json";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

async function sources(root, prefix = "") {
  const files = {};
  for (const entry of await readdir(join(root, prefix), {
    withFileTypes: true,
  })) {
    if (["node_modules", "dist"].includes(entry.name)) continue;
    const path = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in scaffold: ${path}`);
    if (entry.isDirectory()) Object.assign(files, await sources(root, path));
    else files[path] = await readFile(join(root, path), "utf8");
  }
  return files;
}

export async function generate(consumer, destination, template = source) {
  if (
    !/^[a-z][a-z0-9-]*$/.test(consumer.id) ||
    typeof consumer.title !== "string" ||
    typeof consumer.empty !== "string" ||
    !Array.isArray(consumer.items) ||
    consumer.items.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        !item.id ||
        typeof item.title !== "string" ||
        typeof item.detail !== "string" ||
        typeof item.reviewed !== "boolean",
    ) ||
    new Set(consumer.items.map((item) => item.id)).size !==
      consumer.items.length
  ) {
    throw new Error("Expected consumer id, title, empty and items.");
  }
  const files = await sources(template);
  const provenance = JSON.parse(files["provenance.json"]);
  const pkg = JSON.parse(files["package.json"]);
  pkg.name = `bb-plugin-${consumer.id}`;
  pkg.bb.name = consumer.title;
  files["package.json"] = JSON.stringify(pkg, null, 2) + "\n";
  files["consumer.json"] = JSON.stringify(consumer, null, 2) + "\n";
  // Exclusive directory creation refuses existing files/directories/symlinks.
  // Updates never use this function on the adopted package.
  await mkdir(destination);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await writeFile(join(destination, path), content, { flag: "wx" });
  }
  const record = {
    ...provenance,
    consumer,
    hashes: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, hash(content)]),
    ),
  };
  await writeFile(
    join(destination, recordName),
    JSON.stringify(record, null, 2) + "\n",
    { flag: "wx" },
  );
  return record;
}

export async function proposeUpdate(adopted, destination, template = source) {
  const root = await realpath(adopted);
  const candidate = join(
    await realpath(dirname(resolve(destination))),
    basename(resolve(destination)),
  );
  if (inside(root, candidate))
    throw new Error("Candidate must be outside the adopted package.");
  const previous = JSON.parse(await readFile(join(root, recordName), "utf8"));
  // Validate before creating anything; provenance must never name outside files.
  for (const path of Object.keys(previous.hashes)) {
    if (
      isAbsolute(path) ||
      path
        .split(/[\\/]/)
        .some((part) => part === ".." || part === "." || part === "")
    )
      throw new Error("Invalid provenance path.");
  }
  const next = await generate(previous.consumer, candidate, template);
  const report = [];
  for (const path of new Set([
    ...Object.keys(previous.hashes),
    ...Object.keys(next.hashes),
  ])) {
    let current;
    try {
      const local = join(root, path);
      const actual = await realpath(local);
      if (!inside(root, actual) || (await lstat(local)).isSymbolicLink())
        throw new Error(`Refusing symlink: ${path}`);
      current = hash(await readFile(local));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const base = previous.hashes[path];
    const upstream = next.hashes[path];
    const status =
      current === upstream
        ? "unchanged"
        : current === base
          ? "upstream"
          : upstream === base
            ? "customized"
            : "conflict";
    report.push({ path, status });
  }
  return {
    from: previous.revision,
    to: next.revision,
    candidate,
    files: report,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [command, input, output, ...rest] = process.argv.slice(2);
    if (
      !input ||
      !output ||
      rest.length ||
      !["create", "update"].includes(command)
    )
      throw new Error(
        "Usage: node scripts/ui-scaffold.mjs create <consumer.json> <new-directory> | update <adopted-directory> <new-candidate-directory>",
      );
    const result =
      command === "create"
        ? await generate(
            JSON.parse(await readFile(input, "utf8")),
            resolve(output),
          )
        : await proposeUpdate(input, output);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
