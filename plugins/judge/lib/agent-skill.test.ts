import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { fixtureHostOptions, setupRunner } from "./runner-fixtures.ts";
import { parseAgentInput } from "./agent-contract.ts";
import { readSetYaml } from "./sets-yaml.ts";

test("shipped skill command examples expose actual help and saved/tool examples pass shared validators offline", async () => {
  const source = readFileSync(
    new URL("../skills/judge/SKILL.md", import.meta.url),
    "utf8",
  );
  const h = await setupRunner(createFakePluginHost(fixtureHostOptions));
  try {
    let commands = 0;
    for (const [, block] of source.matchAll(/```sh\n([\s\S]*?)```/g)) {
      for (const line of block!.trim().split("\n")) {
        const words = line
          .match(/'[^']*'|"[^"]*"|\S+/g)!
          .map((word) => word.replace(/^(['"])(.*)\1$/, "$2"));
        assert.deepEqual(words.splice(0, 2), ["bb", "judge"]);
        const result = await h.harness.behavior.runCli([...words, "--help"]);
        assert.equal(result.exitCode, 0, line);
        assert.match(result.stdout, /Usage:\s+bb judge/);
        commands++;
      }
    }
    assert.equal(commands, 12);
    for (const [, block] of source.matchAll(/```json\n([\s\S]*?)```/g))
      parseAgentInput(JSON.parse(block!));
    const yaml = /```yaml\n([\s\S]*?)```/.exec(source)![1]!;
    const { definition } = readSetYaml(yaml);
    assert.equal(definition.cases.length, 4);
    assert.equal(
      definition.steps[0]!.questions.unexpected_provider?.type,
      "noul",
    );
    assert.equal(h.bodies.length, 0);
    assert.equal(h.harness.inspection.sdk.calls.length, 0);
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
