const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCouncilAgentRelease, parseCouncilTurnStart } = require("../electron/council-control-server.cjs");

test("accepts launcher phase plus optional stable agent binding key", () => {
  assert.deepEqual(parseCouncilTurnStart({ phase: "start", traceId: "trace_123", helperPid: 42, bindingKey: "agent:alice" }), { traceId: "trace_123", helperPid: 42, bindingKey: "agent:alice" });
});

test("rejects malformed binding keys, phases and unknown privileged fields", () => {
  assert.throws(() => parseCouncilTurnStart({ phase: "start", traceId: "trace_123", helperPid: 42, bindingKey: "../alice" }), /bindingKey/);
  assert.throws(() => parseCouncilTurnStart({ phase: "heartbeat", traceId: "trace_123", helperPid: 42, bindingKey: "agent:alice" }), /phase/);
  assert.throws(() => parseCouncilTurnStart({ phase: "start", traceId: "trace_123", helperPid: 42, bindingKey: "agent:alice", command: "whoami" }), /unknown/);
});

test("agent release accepts only one validated binding key", () => {
  assert.deepEqual(parseCouncilAgentRelease({ bindingKey: "agent:alice" }), { bindingKey: "agent:alice" });
  assert.throws(() => parseCouncilAgentRelease({ bindingKey: "agent:alice", command: "close-all" }), /unknown/);
});
