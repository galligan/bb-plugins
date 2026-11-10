import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  cp,
  symlink,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate, proposeUpdate } from "./ui-scaffold.mjs";

const template = new URL("../scaffolds/nav-panel/", import.meta.url);
const consumer = JSON.parse(
  await readFile(
    new URL("../scaffolds/consumers/worktrees.json", import.meta.url),
  ),
);

test("updates preserve customized and extra files, report conflicts and provide an independent candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "bb-scaffold-"));
  try {
    const adopted = join(root, "adopted");
    await generate(consumer, adopted);
    await assert.rejects(generate(consumer, adopted), { code: "EEXIST" });
    const original = await readFile(join(adopted, "app.tsx"), "utf8");
    await writeFile(
      join(adopted, "app.tsx"),
      original + "\n// local customization\n",
    );
    await writeFile(join(adopted, "custom.txt"), "preserve me");
    const upstream = join(root, "upstream");
    await cp(fileURLToPath(template), upstream, {
      recursive: true,
      filter: (path) =>
        !path.includes("node_modules") && !path.includes("dist"),
    });
    await writeFile(
      join(upstream, "app.tsx"),
      original + "\n// upstream improvement\n",
    );
    const provenance = JSON.parse(
      await readFile(join(upstream, "provenance.json")),
    );
    await writeFile(
      join(upstream, "provenance.json"),
      JSON.stringify({ ...provenance, revision: 2 }),
    );
    await rm(join(upstream, "components/ui/motion.ts"));
    await rm(join(adopted, "server.ts"));
    const report = await proposeUpdate(
      adopted,
      join(root, "candidate"),
      upstream,
    );
    assert.equal(
      report.files.find((file) => file.path === "components/ui/motion.ts")
        .status,
      "upstream",
    );
    assert.equal(
      report.files.find((file) => file.path === "server.ts").status,
      "customized",
    );
    assert.equal(report.from, 1);
    assert.equal(report.to, 2);
    assert.equal(
      report.files.find((file) => file.path === "app.tsx").status,
      "conflict",
    );
    assert.equal(
      report.files.find((file) => file.path === "provenance.json").status,
      "upstream",
    );
    assert.equal(
      await readFile(join(adopted, "app.tsx"), "utf8"),
      original + "\n// local customization\n",
    );
    assert.equal(
      await readFile(join(adopted, "custom.txt"), "utf8"),
      "preserve me",
    );
    assert.equal(
      JSON.parse(await readFile(join(adopted, "scaffold.json"))).revision,
      1,
    );
    const same = await proposeUpdate(adopted, join(root, "same"));
    assert.equal(
      same.files.find((file) => file.path === "app.tsx").status,
      "customized",
    );
    await assert.rejects(
      proposeUpdate(adopted, join(adopted, "nested")),
      /outside/,
    );
    await symlink(adopted, join(root, "alias"));
    await assert.rejects(
      proposeUpdate(adopted, join(root, "alias", "nested")),
      /outside/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
