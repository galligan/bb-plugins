import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { readCallerYaml } from "./caller-file.ts";
import judge from "../server.ts";

const yaml = `schemaVersion: 1
id: fixture
description: Public test definition
inputs:
  text: {from: thread.title}
questions:
  q: {type: noul, instructions: Is text present?}
outcomes:
  present: {q: q, gte: 0.5}
`;
function setup(status = "connected") {
  return createFakePluginHost({
    pluginId: "judge",
    sdk: {
      threads: { get: async () => ({ environmentId: "env-remote" }) },
      environments: { get: async () => ({ hostId: "remote" }) },
      hosts: {
        list: async () => [{ id: "remote", name: "Remote host", status }],
      },
      files: {
        read: async ({ path }) => ({
          path,
          content: yaml,
          contentEncoding: "utf8",
          sizeBytes: Buffer.byteLength(yaml),
          sha256: "fixture",
        }),
      },
    },
  });
}

test("relative caller files route thread to environment to connected remote host, never server filesystem", async () => {
  const { bb, harness } = setup();
  try {
    const signal = new AbortController().signal;
    assert.equal(
      await readCallerYaml(bb, "defs/fixture.yaml", undefined, {
        threadId: "thread",
        cwd: "/remote/repo",
        signal,
      }),
      yaml,
    );
    assert.deepEqual(harness.inspection.sdk.callsTo("threads.get"), [
      [{ threadId: "thread", signal }],
    ]);
    assert.deepEqual(harness.inspection.sdk.callsTo("environments.get"), [
      [{ environmentId: "env-remote", signal }],
    ]);
    assert.deepEqual(harness.inspection.sdk.callsTo("files.read"), [
      [{ path: "/remote/repo/defs/fixture.yaml", hostId: "remote", signal }],
    ]);
    assert.equal(harness.inspection.sdk.callsTo("system.config").length, 0);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("no-thread imports require explicit machine and absolute host path; Windows paths preserve host semantics", async () => {
  const { bb, harness } = setup();
  try {
    const ctx = { signal: new AbortController().signal };
    await assert.rejects(
      readCallerYaml(bb, "/remote/fixture.yaml", undefined, ctx),
      /machine_required/,
    );
    await assert.rejects(
      readCallerYaml(bb, "relative.yaml", "remote", ctx),
      /absolute_path_required/,
    );
    assert.equal(
      await readCallerYaml(bb, "/remote/fixture.yaml", "Remote host", ctx),
      yaml,
    );
    assert.equal(
      await readCallerYaml(bb, "C:\\remote\\fixture.yaml", "remote", ctx),
      yaml,
    );
    assert.equal(harness.inspection.sdk.callsTo("threads.get").length, 0);
    assert.equal(harness.inspection.sdk.callsTo("environments.get").length, 0);
    assert.equal(harness.inspection.sdk.callsTo("files.read").length, 2);
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("explicit target paths choose their own dialect and UNC cwd resolves relative imports", async () => {
  const { bb, harness } = setup();
  try {
    const signal = new AbortController().signal;
    for (const [file, cwd, machine, expected] of [
      ["/remote/fixture.yaml", "C:\\caller", "remote", "/remote/fixture.yaml"],
      [
        "C:\\remote\\fixture.yaml",
        "/caller",
        "remote",
        "C:\\remote\\fixture.yaml",
      ],
      [
        "defs/fixture.yaml",
        "\\\\server\\share\\repo",
        undefined,
        "\\\\server\\share\\repo\\defs\\fixture.yaml",
      ],
      [
        "defs/fixture.yaml",
        "C:\\repo",
        undefined,
        "C:\\repo\\defs\\fixture.yaml",
      ],
    ] as const) {
      await readCallerYaml(bb, file, machine, {
        threadId: "thread",
        cwd,
        signal,
      });
      const call = harness.inspection.sdk.callsTo("files.read").at(-1)![0] as {
        path: string;
        hostId: string;
      };
      assert.equal(call.path, expected);
      assert.equal(call.hostId, "remote");
    }
  } finally {
    await harness.lifecycle.dispose();
  }
});

test("missing environments, unavailable/ambiguous machines and oversized/binary files fail without fallback", async () => {
  for (const failure of [
    "environment",
    "sleeping",
    "ambiguous",
    "bytes",
    "encoding",
  ] as const) {
    const { bb, harness } = setup(
      failure === "sleeping" ? "disconnected" : "connected",
    );
    try {
      if (failure === "environment")
        harness.sdk.stub("threads.get", async () => ({ environmentId: null }));
      if (failure === "ambiguous")
        harness.sdk.stub("hosts.list", async () => [
          { id: "remote", name: "Remote host", status: "connected" },
          { id: "second", name: "Remote host", status: "connected" },
        ]);
      if (failure === "bytes")
        harness.sdk.stub("files.read", async () => ({
          contentEncoding: "utf8",
          sizeBytes: 300000,
          content: "x",
        }));
      if (failure === "encoding")
        harness.sdk.stub("files.read", async () => ({
          contentEncoding: "base64",
          sizeBytes: 1,
          content: "eA==",
        }));
      await assert.rejects(
        readCallerYaml(
          bb,
          "/remote/file.yaml",
          failure === "ambiguous" ? "Remote host" : undefined,
          { threadId: "thread", signal: new AbortController().signal },
        ),
      );
      assert.equal(
        harness.inspection.sdk.callsTo("files.read").length,
        failure === "bytes" || failure === "encoding" ? 1 : 0,
      );
    } finally {
      await harness.lifecycle.dispose();
    }
  }
});

test("question import/save aliases use routed SDK file reads and never invoke inference", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("offline only");
  });
  const { bb, harness } = setup();
  try {
    await judge(bb);
    for (const name of ["import", "save"]) {
      const result = await harness.behavior.runCli([
        "questions",
        name,
        "--file",
        "/remote/fixture.yaml",
        "--machine",
        "remote",
        "--json",
      ]);
      assert.equal(result.exitCode, 0);
      assert.equal(JSON.parse(result.stdout).definition.id, "fixture");
    }
    const missing = await harness.behavior.runCli([
      "questions",
      "import",
      "--file",
      "/remote/fixture.yaml",
      "--json",
    ]);
    assert.equal(missing.exitCode, 1);
    assert.match(JSON.parse(missing.stdout).error.hint, /--machine/);
    const badFlag = await harness.behavior.runCli([
      "questions",
      "import",
      "--file",
      "/remote/fixture.yaml",
      "--not-private",
      "--json",
    ]);
    assert.equal(badFlag.exitCode, 1);
    assert.equal(harness.inspection.sdk.callsTo("files.read").length, 2);
  } finally {
    await harness.lifecycle.dispose();
  }
});
