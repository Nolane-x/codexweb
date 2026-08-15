const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  assertConversationUrl,
  bindCurrentConversationAsLead,
  listObservations,
  readObservationScreenshot,
  setSupervisorManager,
  supervisorStatus,
} = require("../electron/council-owner-client.cjs");

function withOwnerDescriptor(prefix, token = "a".repeat(64)) {
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
    root,
    restore() {
      if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
      else process.env.CODEX_CHATGPT_WEB_HOME = previous;
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

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
  const fixture = withOwnerDescriptor("council-owner-client-");
  try {
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
  } finally { fixture.restore(); }
});

test("supervisor owner methods target explicit loopback operations without exposing owner token", async () => {
  const fixture = withOwnerDescriptor("council-owner-supervisor-", "c".repeat(64));
  try {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { enabled: true } }),
      };
    };
    await supervisorStatus({ fetchImpl, timeoutMs: 250 });
    await setSupervisorManager("lead", { fetchImpl, timeoutMs: 250 });
    await listObservations({ fetchImpl, timeoutMs: 250 });
    assert.equal(calls[0].url, "http://127.0.0.1:17842/api/owner/supervisor/status");
    assert.equal(calls[1].url, "http://127.0.0.1:17842/api/owner/supervisor/manager");
    assert.deepEqual(JSON.parse(calls[1].options.body), { agent_id: "lead" });
    assert.equal(calls[2].url, "http://127.0.0.1:17842/api/owner/observations/list");
    for (const call of calls) {
      assert.equal(call.options.redirect, "error");
      assert.equal(call.options.method, "POST");
      assert.equal(call.options.headers.authorization, `Bearer ${"c".repeat(64)}`);
      assert.equal(JSON.stringify(call.options.body).includes("c".repeat(64)), false);
    }
  } finally { fixture.restore(); }
});

test("observation screenshot owner method returns a renderer-safe data URL", async () => {
  const fixture = withOwnerDescriptor("council-owner-screenshot-");
  try {
    let requested;
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const value = await readObservationScreenshot("obs_123456789abc", "lead-12345678.png", {
      timeoutMs: 250,
      fetchImpl: async (url, options) => {
        requested = { url, options };
        return {
          ok: true,
          status: 200,
          headers: { get: name => name.toLowerCase() === "content-type" ? "image/png" : null },
          arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
        };
      },
    });
    assert.equal(requested.url, "http://127.0.0.1:17842/api/owner/observations/screenshot");
    assert.deepEqual(JSON.parse(requested.options.body), { run_id: "obs_123456789abc", screenshot_id: "lead-12345678.png" });
    assert.equal(value, `data:image/png;base64,${png.toString("base64")}`);
  } finally { fixture.restore(); }
});

test("owner fallback aborts a stalled local owner request", async () => {
  const fixture = withOwnerDescriptor("council-owner-timeout-", "b".repeat(64));
  try {
    await assert.rejects(
      () => bindCurrentConversationAsLead({ conversationUrl: "https://chatgpt.com/c/abc", projectName: "Nolane" }, {
        timeoutMs: 100,
        fetchImpl: async (_url, options) => await new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        }),
      }),
      /timed out|abort/i,
    );
  } finally { fixture.restore(); }
});
