import assert from "node:assert/strict";
import { test } from "node:test";

import { repoLocation } from "./remote.ts";

const at = (url: string | null) => repoLocation(url, "/Users/u/code/checkout");

test("GitHub remotes map to gh/<owner>/<repo> in every URL form", () => {
  const expected = ["gh", "outfitter-dev", "trails"];
  assert.deepEqual(at("https://github.com/outfitter-dev/trails.git"), expected);
  assert.deepEqual(at("https://github.com/outfitter-dev/trails"), expected);
  assert.deepEqual(at("git@github.com:outfitter-dev/trails.git"), expected);
  assert.deepEqual(
    at("ssh://git@github.com/outfitter-dev/trails.git"),
    expected,
  );
  assert.deepEqual(
    at("https://user:token@GitHub.com/outfitter-dev/trails.git/"),
    expected,
  );
});

test("Entire drops its region host and the /et/ path prefix", () => {
  assert.deepEqual(
    at("entire://aws-us-east-2.entire.io/et/galligan/designlab"),
    ["et", "galligan", "designlab"],
  );
});

test("Cursor Origin maps to cursor, with or without the git/ prefix", () => {
  const expected = ["cursor", "acme", "checkout"];
  assert.deepEqual(at("https://origin.cursor.com/acme/checkout.git"), expected);
  assert.deepEqual(
    at("https://origin.cursor.com/git/acme/checkout.git"),
    expected,
  );
});

test("GitLab keeps nested groups", () => {
  assert.deepEqual(at("git@gitlab.com:group/sub/repo.git"), [
    "gl",
    "group",
    "sub",
    "repo",
  ]);
});

test("hosted Gitea and Codeberg have aliases", () => {
  assert.deepEqual(at("https://gitea.com/org/repo.git"), [
    "gitea",
    "org",
    "repo",
  ]);
  assert.deepEqual(at("https://codeberg.org/org/repo"), [
    "codeberg",
    "org",
    "repo",
  ]);
});

test("an unknown host, such as self-hosted Gitea, uses its hostname without the port", () => {
  assert.deepEqual(at("ssh://gitea@git.example.com:2222/Org/Repo.git"), [
    "git.example.com",
    "Org",
    "Repo",
  ]);
});

test("no remote, a local remote, or junk falls back to _local/<checkout folder>", () => {
  const expected = ["_local", "checkout"];
  assert.deepEqual(at(null), expected);
  assert.deepEqual(at(""), expected);
  assert.deepEqual(at("/srv/git/project.git"), expected);
  assert.deepEqual(at("file:///srv/git/project.git"), expected);
  assert.deepEqual(at("https://github.com/"), expected);
});

test("path segments can never traverse", () => {
  assert.deepEqual(at("https://github.com/../../etc"), ["gh", "etc"]);
});
