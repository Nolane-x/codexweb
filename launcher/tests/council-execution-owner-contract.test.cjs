const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ownerClient = require("../electron/council-owner-client.cjs");

function withOwnerDescriptor(prefix, token = "d".repeat(64)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  const dir = path.join(root, "council");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "owner-control.json"), JSON.stringify({
    version: 1,
    endpoint: "http://127.0.0.1:17842/api/owner",
    token,
  }));
  return {
    token,
    restore() {
      if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
      else process.env.CODEX_CHATGPT_WEB_HOME = previous;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function okFetch(calls) {
  return async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { ok: true } }) };
  };
}

test("owner client exposes only typed execution run and agent operations", async () => {
  for (const name of [
    "listExecutionRuns",
    "readExecutionRun",
    "readExecutionEvents",
    "readExecutionReceipts",
    "cancelExecutionRun",
    "focusExecutionAgent",
    "captureExecutionAgent",
    "retryExecutionRun",
  ]) assert.equal(typeof ownerClient[name], "function", `${name} must be exported`);

  const fixture = withOwnerDescriptor("council-execution-owner-");
  try {
    const calls = [];
    const options = { fetchImpl: okFetch(calls), timeoutMs: 250 };
    await ownerClient.listExecutionRuns(options);
    await ownerClient.readExecutionRun("run_1", options);
    await ownerClient.readExecutionEvents("run_1", options);
    await ownerClient.readExecutionReceipts(options);
    await ownerClient.cancelExecutionRun("run_1", options);
    await ownerClient.focusExecutionAgent("critic", options);
    await ownerClient.captureExecutionAgent("critic", options);
    await ownerClient.retryExecutionRun("run_1", options);

    assert.deepEqual(calls.map(call => call.url), [
      "http://127.0.0.1:17842/api/owner/execution/runs",
      "http://127.0.0.1:17842/api/owner/execution/read",
      "http://127.0.0.1:17842/api/owner/execution/events",
      "http://127.0.0.1:17842/api/owner/execution/receipts",
      "http://127.0.0.1:17842/api/owner/execution/cancel",
      "http://127.0.0.1:17842/api/owner/execution/focus",
      "http://127.0.0.1:17842/api/owner/execution/capture",
      "http://127.0.0.1:17842/api/owner/execution/retry",
    ]);
    assert.deepEqual(calls.map(call => JSON.parse(call.options.body)), [
      {},
      { run_id: "run_1" },
      { run_id: "run_1" },
      {},
      { run_id: "run_1" },
      { agent_id: "critic" },
      { agent_id: "critic" },
      { run_id: "run_1" },
    ]);
    for (const call of calls) {
      assert.equal(call.options.headers.authorization, `Bearer ${fixture.token}`);
      const serialized = call.options.body;
      assert.equal(serialized.includes(fixture.token), false);
      assert.equal(/conversation_url|selector|script|prompt/.test(serialized), false);
    }
  } finally { fixture.restore(); }
});

test("Electron main and preload expose eight bounded execution IPC methods without owner credentials", () => {
  const root = path.join(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "electron", "main-council.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(root, "electron", "preload.cjs"), "utf8");
  const types = fs.readFileSync(path.join(root, "src", "types.ts"), "utf8");
  const expected = [
    "councilExecutionRuns",
    "councilExecutionRun",
    "councilExecutionEvents",
    "councilExecutionReceipts",
    "cancelCouncilExecution",
    "focusCouncilExecutionAgent",
    "captureCouncilExecutionAgent",
    "retryCouncilExecution",
  ];
  for (const name of expected) {
    assert.match(preload, new RegExp(`${name}\\s*:`));
    assert.match(types, new RegExp(`${name}\\s*\\(`));
  }
  for (const channel of [
    "launcher:council-execution-runs",
    "launcher:council-execution-read",
    "launcher:council-execution-events",
    "launcher:council-execution-receipts",
    "launcher:council-execution-cancel",
    "launcher:council-execution-focus",
    "launcher:council-execution-capture",
    "launcher:council-execution-retry",
  ]) assert.match(main, new RegExp(channel));

  assert.doesNotMatch(preload, /owner-control|authorization|Bearer|conversationUrl|\bselector\b|\bscript\b|\bprompt\b/);
  assert.doesNotMatch(types, /executionConversationUrl|executionSelector|executionScript|executionPrompt/);
});
