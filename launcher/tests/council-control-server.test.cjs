const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCouncilTurnStart } = require("../electron/council-control-server.cjs");

test("accepts an optional stable agent binding key", () => {
  assert.deepEqual(parseCouncilTurnStart({ traceId: "trace_123", helperPid: 42, bindingKey: "agent:alice" }), { traceId: "trace_123", helperPid: 42, bindingKey: "agent:alice" });
});

test("rejects malformed binding keys and unknown privileged fields", () => {
  assert.throws(() => parseCouncilTurnStart({ traceId: "trace_123", helperPid: 42, bindingKey: "../alice" }), /bindingKey/);
  assert.throws(() => parseCouncilTurnStart({ traceId: "trace_123", helperPid: 42, bindingKey: "agent:alice", command: "whoami" }), /unknown/);
});
