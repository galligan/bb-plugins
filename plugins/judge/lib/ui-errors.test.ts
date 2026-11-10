import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  setupEvaluation,
  evaluationDefinition,
} from "./evaluation-fixtures.ts";
import { fixtureHostOptions } from "./runner-fixtures.ts";
import { message, PUBLIC_DOMAIN_ERRORS } from "./ui-errors.ts";
import { ValidationError } from "./json.ts";
test("real strict RPC preserves only safe actionable domain refusals; privacy/calibration remain enforced without new inference", async (t) => {
  const h = await setupEvaluation(createFakePluginHost(fixtureHostOptions));
  try {
    const def = evaluationDefinition();
    def.cases = def.cases.slice(0, 1);
    h.api.sets.save(JSON.stringify(def));
    const report = await h.api.evaluations.test({ id: "synthetic" });
    assert.equal(report.complete, true);
    h.api.models.save({ ...h.repository.getModel("public")!, timeoutMs: 2500 });
    const calls = h.bodies.length;
    const defaultsBefore = h.repository.getDefaults();
    const binding = {
      id: "binding",
      setId: "synthetic",
      event: "thread.idle",
      badges: {},
    };
    const cases = [
      [
        "calibration.accept",
        { id: "synthetic", run: report.id },
        "calibration_not_current",
        "fresh complete case report",
      ],
      [
        "models.default",
        { id: "public", private: true },
        "private_model_required",
        "explicitly permits private data",
      ],
      [
        "triggers.save",
        { ...binding, setId: "missing" },
        "missing_set",
        "existing saved set",
      ],
      [
        "triggers.save",
        { ...binding, badges: { missing: "Label" } },
        "unknown_badge_outcome",
        "saved set's final outcomes",
      ],
      [
        "triggers.enable",
        { id: "missing", enabled: true },
        "missing_trigger",
        "no longer exists",
      ],
    ] as const;
    for (const [method, input, reason, hint] of cases)
      await assert.rejects(
        () => h.harness.behavior.callRpc(method, input),
        (error: unknown) => {
          assert.equal((error as { code: string }).code, "invalid");
          assert.equal((error as Error).message, reason);
          assert.ok(message(error).includes(hint));
          return true;
        },
      );
    assert.equal(h.bodies.length, calls);
    assert.equal(h.repository.evaluations.getAcceptance("synthetic"), null);
    assert.deepEqual(h.repository.getDefaults(), defaultsBefore);
    assert.equal(h.repository.triggers.get("binding"), null);
    for (const thrown of [
      new ValidationError("DUMMY_PRIVATE_UPSTREAM_DETAIL"),
      new Error("DUMMY_PRIVATE_UPSTREAM_DETAIL"),
    ]) {
      t.mock.method(h.api.triggers, "save", () => {
        throw thrown;
      });
      await assert.rejects(
        () => h.harness.behavior.callRpc("triggers.save", binding),
        (error: unknown) => {
          assert.ok(!String(error).includes("DUMMY_PRIVATE"));
          assert.ok(!message(error).includes("DUMMY_PRIVATE"));
          assert.ok(!PUBLIC_DOMAIN_ERRORS.has((error as Error).message));
          return true;
        },
      );
    }
    assert.ok(
      message({ code: "invalid", message: "constructor" }).includes(
        "Check the IDs",
      ),
    );
    assert.ok(
      message({ code: "__proto__", message: "__proto__" }).includes(
        "could not complete",
      ),
    );
  } finally {
    await h.harness.lifecycle.dispose();
  }
});
