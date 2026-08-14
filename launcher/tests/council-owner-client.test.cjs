const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assertConversationUrl, bindCurrentConversationAsLead } = require("../electron/council-owner-client.cjs");

test("owner fallback accepts only persistent chatgpt.com conversation URLs", () => {
  assert.equal(assertConversationUrl("https://chatgpt.com/c/abc_123"), "https://chatgpt.com/c/abc_123");
  for (const value of [
    "https://chatgpt.com/",
    "https://chatgpt.com/c/abc?x=1",
    "https://evil.example/c/abc",
    "http://chatgpt.com/c/abc",
  ]) assert.throws(() => assertConversationUrl(value), /persistent ChatGPT conversation/);
});

test("owner fallback pins redirect policy and carries an abort signal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "council-owner-client-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  try {
    const dir = path.join(root, "council");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "owner-control.json"), JSON.stringify({
      version: 1,
      endpoint: "http://127.0.0.1:17842/api/owner",
      token: "a".repeat(64),
    }));
    let init;
    const result = await bindCurrentConversationAsLead({
      conversationUrl: "https://chatgpt.com/c/abc_123",
      projectName: "Nolane",
    }, {
      timeoutMs: 250,
      fetchImpl: async (_url, options) => {
        init = options;
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { bound: true } }) };
      },
    });
    assert.deepEqual(result, { bound: true });
    assert.equal(init.redirect, "error");
    assert.equal(init.method, "POST");
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    assert.match(init.headers.authorization, /^Bearer /);
  } finally {
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("owner fallback aborts a stalled local owner request", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "council-owner-timeout-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  try {
    const dir = path.join(root, "council");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "owner-control.json"), JSON.stringify({
      version: 1,
      endpoint: "http://127.0.0.1:17842/api/owner",
      token: "b".repeat(64),
    }));
    await assert.rejects(
      () => bindCurrentConversationAsLead({ conversationUrl: "https://chatgpt.com/c/abc", projectName: "Nolane" }, {
        timeoutMs: 100,
        fetchImpl: async (_url, options) => await new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        }),
      }),
      /timed out|abort/i,
    );
  } finally {
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
