const test = require("node:test");
const assert = require("node:assert/strict");
const { AgentSurfaceRegistry } = require("../electron/agent-surface-registry.cjs");

test("reuses the same bound surface for the same agent binding across new trace ids", () => {
  const registry = new AgentSurfaceRegistry({ maxSurfaces: 5 });
  registry.attach({ bindingKey: "agent:alice", tabId: "tab-a", surfaceId: "surface-a" });
  assert.deepEqual(registry.find("agent:alice"), { bindingKey: "agent:alice", tabId: "tab-a", surfaceId: "surface-a" });
  assert.equal(registry.find("agent:bob"), null);
});

test("does not allow one surface or tab to be rebound to another agent", () => {
  const registry = new AgentSurfaceRegistry({ maxSurfaces: 5 });
  registry.attach({ bindingKey: "agent:alice", tabId: "tab-a", surfaceId: "surface-a" });
  assert.throws(() => registry.attach({ bindingKey: "agent:bob", tabId: "tab-a", surfaceId: "surface-b" }), /already bound/);
  assert.throws(() => registry.attach({ bindingKey: "agent:bob", tabId: "tab-b", surfaceId: "surface-a" }), /already bound/);
});

test("caps durable bound surfaces and releases explicitly", () => {
  const registry = new AgentSurfaceRegistry({ maxSurfaces: 2 });
  registry.attach({ bindingKey: "agent:a", tabId: "tab-a", surfaceId: "surface-a" });
  registry.attach({ bindingKey: "agent:b", tabId: "tab-b", surfaceId: "surface-b" });
  assert.throws(() => registry.attach({ bindingKey: "agent:c", tabId: "tab-c", surfaceId: "surface-c" }), /capacity/);
  registry.release("agent:a");
  registry.attach({ bindingKey: "agent:c", tabId: "tab-c", surfaceId: "surface-c" });
  assert.equal(registry.find("agent:c").surfaceId, "surface-c");
});
