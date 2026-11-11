import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../../server.ts";
import { openSetup } from "../setup/storage.ts";
import { openWork } from "./storage.ts";
import { workSchema } from "./contracts.ts";

function fixture(t: TestContext) {
  let queued = false;
  let fail = false;
  let sender: string | null = "thr_monitor";
  const threads = new Map(
    ["thr_main", "thr_worker", "thr_monitor", "thr_foreign"].map((id) => [
      id,
      makeThreadResponse({ id }),
    ]),
  );
  const host = createFakePluginHost({
    pluginId: "bbots",
    sdk: {
      threads: {
        get: async ({ threadId }) => {
          const thread = threads.get(threadId);
          if (!thread) throw new Error("Missing native thread");
          return thread;
        },
        send: async () => {
          if (fail) throw new Error("Lost native receipt");
          return queued
            ? {
                ok: true,
                delivery: "queued",
                queuedMessage: makeQueueEntry({
                  id: "queue_report",
                  waitingOn: { kind: "thread-busy" },
                }),
              }
            : { ok: true, delivery: "sent" };
        },
        message: async () => ({
          message: {
            kind: "conversation",
            role: "user",
            initiator: sender ? "agent" : "user",
            senderThreadId: sender,
          },
          before: [],
          after: [],
        }),
      },
    },
  });
  t.after(() => host.harness.lifecycle.dispose());
  plugin(host.bb);
  const store = openSetup(host.bb.storage),
    work = openWork(host.bb.storage, store);
  const setup = store.plan({
    requestId: randomUUID(),
    hostId: "host_home",
    name: "Bob",
    associations: { mode: "none" },
  });
  store.setHome(setup.botId, "/home/bob");
  store.setProject(setup.botId, "project_home");
  store.phase(setup.botId, "project-ready", "spawning");
  store.bind(setup.botId, "thr_main");
  store.phase(setup.botId, "owned", "ready");
  const worker = work.plan(
    workSchema.parse({
      requestId: randomUUID(),
      botId: setup.botId,
      title: "Investigate",
      projectId: "project_work",
      environmentId: "env_work",
      author: "fixture-user",
      reason: "Explicit work",
      agreement: {
        assignment: "Investigate and report",
        reportTo: { kind: "thread", threadId: "thr_monitor" },
      },
    }),
  );
  work.start(worker.conversationId);
  work.bind(worker.conversationId, "thr_worker");
  return {
    ...host,
    store,
    work,
    setup,
    worker,
    threads,
    setQueued: () => {
      queued = true;
    },
    setFail: () => {
      fail = true;
    },
    clearSender: () => {
      sender = null;
    },
  };
}

test("report uses the caller's explicit non-main contract and native queue-if-active attribution", async (t) => {
  const f = fixture(t);
  f.setQueued();
  const result = await f.harness.behavior.runCli(
    ["report", "Finding with evidence", "--json"],
    { threadId: "thr_worker" },
  );
  assert.equal(result.exitCode, 0);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.threadId, "thr_monitor");
  assert.equal(receipt.delivery, "queued");
  assert.equal(receipt.queuedMessageId, "queue_report");
  assert.deepEqual(receipt.waitingOn, { kind: "thread-busy" });
  assert.match(receipt.evidence, /reading.*not established/);
  const [call] = f.harness.inspection.sdk.callsTo("threads.send");
  const args = call![0] as {
    threadId: string;
    senderThreadId: string;
    mode: string;
    input: { text: string }[];
  };
  assert.equal(args.threadId, "thr_monitor");
  assert.equal(args.senderThreadId, "thr_worker");
  assert.equal(args.mode, "queue-if-active");
  assert.match(
    args.input[0]!.text,
    /does not authorize resuming a previously canceled assignment/,
  );
});

test("unowned and main callers cannot report by assuming a main destination", async (t) => {
  const f = fixture(t);
  for (const ctx of [
    {},
    { threadId: "thr_foreign" },
    { threadId: "thr_main" },
  ]) {
    const result = await f.harness.behavior.runCli(
      ["report", "No implicit target"],
      ctx,
    );
    assert.equal(result.exitCode, 1);
  }
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
});

test("an unowned caller needs an explicit bot for msg but is never adopted", async (t) => {
  const f = fixture(t);
  const refused = await f.harness.behavior.runCli(["msg", "No implicit bot"], {
    threadId: "thr_foreign",
  });
  assert.equal(refused.exitCode, 1);
  const result = await f.harness.behavior.runCli(
    ["msg", "Explicit message", "--bot", f.setup.botId, "--json"],
    { threadId: "thr_foreign" },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).threadId, "thr_main");
  assert.equal(JSON.parse(result.stdout).senderThreadId, "thr_foreign");
  assert.equal(f.store.conversations.ownerOfThread("thr_foreign"), null);
});

test("logical report destination resolves its current verified mapping and refuses an unbound target", async (t) => {
  const f = fixture(t);
  const current = f.work.agreement(f.worker.conversationId);
  f.work.updateAgreement({
    conversationId: f.worker.conversationId,
    expectedRevision: current.revision,
    agreement: {
      ...current.agreement,
      reportTo: {
        kind: "conversation",
        conversationId: f.setup.conversationId,
      },
    },
    author: "fixture-user",
    reason: "New report target",
  });
  const result = await f.harness.behavior.runCli(
    ["report", "Logical destination", "--json"],
    { threadId: "thr_worker" },
  );
  assert.equal(JSON.parse(result.stdout).threadId, "thr_main");
  const other = f.store.profiles.create({
    name: "Alice",
    author: "fixture-user",
    reason: "Second bot",
  });
  f.work.updateAgreement({
    conversationId: f.worker.conversationId,
    expectedRevision: 2,
    agreement: {
      ...current.agreement,
      reportTo: {
        kind: "conversation",
        conversationId: other.mainConversationId,
      },
    },
    author: "fixture-user",
    reason: "Unbound target",
  });
  assert.equal(
    (
      await f.harness.behavior.runCli(["report", "Unbound"], {
        threadId: "thr_worker",
      })
    ).exitCode,
    1,
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 1);
});

test("reply uses the selected native agent sender and refuses a human message without a sender", async (t) => {
  const f = fixture(t);
  const result = await f.harness.behavior.runCli(
    ["reply", "Answer", "--seq", "12", "--json"],
    { threadId: "thr_worker" },
  );
  assert.equal(result.exitCode, 0);
  assert.equal(JSON.parse(result.stdout).threadId, "thr_monitor");
  f.clearSender();
  assert.equal(
    (
      await f.harness.behavior.runCli(
        ["reply", "No guessed recipient", "--seq", "13"],
        { threadId: "thr_worker" },
      )
    ).exitCode,
    1,
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 1);
});

test("deliberate contract changes append a revision and current brief without sending or reparenting", async (t) => {
  const f = fixture(t);
  const agreement = {
    ...f.work.agreement(f.worker.conversationId).agreement,
    reportTo: { kind: "conversation", conversationId: f.setup.conversationId },
  };
  const args = [
    "contract",
    "update",
    f.worker.conversationId,
    "--revision",
    "1",
    "--agreement",
    JSON.stringify(agreement),
    "--author",
    "fixture-user",
    "--reason",
    "Explicit report reassignment",
    "--json",
  ];
  const updated = await f.harness.behavior.runCli(args, {
    threadId: "thr_main",
  });
  assert.equal(updated.exitCode, 0);
  assert.equal(JSON.parse(updated.stdout).revision, 2);
  assert.equal(
    (await f.harness.behavior.runCli(args, { threadId: "thr_main" })).exitCode,
    1,
  );
  const brief = JSON.parse(
    (
      await f.harness.behavior.runCli(["brief", f.setup.botId, "--json"], {
        threadId: "thr_worker",
      })
    ).stdout,
  );
  assert.equal(brief.conversation.id, f.worker.conversationId);
  assert.equal(brief.contract.revision, 2);
  assert.equal(
    brief.contract.agreement.reportTo.conversationId,
    f.setup.conversationId,
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.update").length, 0);
  const workers = JSON.parse(
    (await f.harness.behavior.runCli(["work", "list", f.setup.botId, "--json"]))
      .stdout,
  );
  assert.equal(workers.workers[0].conversation.id, f.worker.conversationId);
  assert.equal(workers.workers[0].requestId, f.worker.requestId);
});

test("uncertain native delivery is sent once and reports uncertainty without a retry", async (t) => {
  const f = fixture(t);
  f.setFail();
  const result = await f.harness.behavior.runCli(
    ["report", "One explicit report"],
    { threadId: "thr_worker" },
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout + result.stderr, /uncertain/);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 1);
});

test("archived, missing and self recipients fail before a native send without unarchiving", async (t) => {
  const f = fixture(t);
  f.threads.set(
    "thr_monitor",
    makeThreadResponse({ id: "thr_monitor", archivedAt: 1 }),
  );
  assert.equal(
    (
      await f.harness.behavior.runCli(["report", "Archived target"], {
        threadId: "thr_worker",
      })
    ).exitCode,
    1,
  );
  f.threads.delete("thr_monitor");
  assert.equal(
    (
      await f.harness.behavior.runCli(["report", "Missing target"], {
        threadId: "thr_worker",
      })
    ).exitCode,
    1,
  );
  assert.equal(
    (
      await f.harness.behavior.runCli(["msg", "Self target"], {
        threadId: "thr_main",
      })
    ).exitCode,
    1,
  );
  assert.equal(f.harness.inspection.sdk.callsTo("threads.send").length, 0);
  assert.equal(f.harness.inspection.sdk.callsTo("threads.unarchive").length, 0);
});
