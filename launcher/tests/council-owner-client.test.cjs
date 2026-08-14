const test = require("node:test");
const assert = require("node:assert/strict");
const { assertConversationUrl } = require("../electron/council-owner-client.cjs");

test("owner fallback accepts only persistent chatgpt.com conversation URLs", () => {
  assert.equal(assertConversationUrl("https://chatgpt.com/c/abc_123"), "https://chatgpt.com/c/abc_123");
  for (const value of [
    "https://chatgpt.com/",
    "https://chatgpt.com/c/abc?x=1",
    "https://evil.example/c/abc",
    "http://chatgpt.com/c/abc",
  ]) assert.throws(() => assertConversationUrl(value), /persistent ChatGPT conversation/);
});
