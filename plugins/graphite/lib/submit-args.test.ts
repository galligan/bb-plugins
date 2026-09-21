import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { submitArgs } from "./submit-args.ts";

describe("submitArgs", () => {
  it("passes the named submit options", () => {
    assert.deepEqual(submitArgs(["--update-only", "--publish"]), {
      ok: true,
      args: ["--update-only", "--publish"],
    });
  });

  it("rejects an unknown option before it can widen a submission", () => {
    assert.deepEqual(submitArgs(["--update-onli"]), {
      ok: false,
      error: "Unknown submit option: --update-onli",
    });
  });
});
