const test = require("node:test");
const assert = require("node:assert/strict");
const { CouncilConnectionSupervisor } = require("../electron/council-connection-supervisor.cjs");

const canonicalState = {
  version: 1,
  generatedAt: "2026-08-14T12:00:00.000Z",
  agents: [
    { id: "alpha", name: "Alpha", role: "Lead", status: "awake", joinedAt: "2026-08-14T11:00:00.000Z", updatedAt: "2026-08-14T12:00:00.000Z" },
    { id: "beta", name: "Beta", role: "Reviewer", status: "awake", joinedAt: "2026-08-14T11:01:00.000Z", updatedAt: "2026-08-14T12:00:00.000Z" },
  ],
  rooms: [
    { id: "room-a", name: "Room A", mission: "A", createdAt: "2026-08-14T11:00:00.000Z", updatedAt: "2026-08-14T12:00:00.000Z" },
    { id: "room-b", name: "Room B", mission: "B", createdAt: "2026-08-14T11:00:00.000Z", updatedAt: "2026-08-14T12:00:00.000Z" },
  ],
  messages: [{ id: "msg-a", roomId: "room-a", authorAgentId: "alpha", kind: "message", body: "hello", threadId: "msg-a", mentions: [], createdAt: "2026-08-14T12:00:00.000Z" }],
  decisions: [],
  tasks: [],
  wakes: [],
  managed: { project: null, agents: [] },
};

const unavailableCapabilities = {
  secureTunnel: { available: false, state: "error", reason: { code: "CAPABILITY_UNAVAILABLE" } },
  localRepo: { available: false, state: "error", reason: { code: "CAPABILITY_UNAVAILABLE" } },
  githubConnector: { available: false, state: "error", reason: { code: "CAPABILITY_UNAVAILABLE" } },
  fullMcp: { available: false, state: "error", reason: { code: "CAPABILITY_UNAVAILABLE" } },
  wakeEngine: { available: false, state: "error", reason: { code: "CAPABILITY_UNAVAILABLE" } },
};

const availableRuntimeCapabilities = {
  secureTunnel: { available: true, state: "ready" },
  localRepo: { available: false, state: "error", reason: { code: "CAPABILITY_UNAVAILABLE" } },
  githubConnector: { available: false, state: "error", reason: { code: "CAPABILITY_UNAVAILABLE" } },
  fullMcp: { available: true, state: "ready" },
  wakeEngine: { available: true, state: "ready" },
};

test("live canonical projection stays visible when every local execution capability is unavailable", async () => {
  const supervisor = new CouncilConnectionSupervisor({
    client: { getSnapshot: async () => ({ schemaVersion: 1, state: canonicalState, cursor: "C1", generatedAt: canonicalState.generatedAt }) },
    capabilities: () => unavailableCapabilities,
  });

  await supervisor.hydrateOnce();
  const runtime = supervisor.snapshot();

  assert.equal(runtime.controlPlane.state, "connected");
  assert.equal(runtime.projection.syncState, "live");
  assert.equal(runtime.projection.cursor, "C1");
  assert.equal(runtime.projection.state.rooms.length, 2);
  assert.equal(runtime.projection.state.agents.length, 2);
  assert.equal(runtime.projection.state.messages.length, 1);
  assert.equal(runtime.managedProject.state, "unattached");
  assert.equal(runtime.capabilities.localRepo.available, false);
});

test("capability evidence republishes immediately without replacing the last-good canonical projection", async () => {
  let live = false;
  let capabilityListener;
  const published = [];
  const supervisor = new CouncilConnectionSupervisor({
    client: { getSnapshot: async () => ({ schemaVersion: 1, state: canonicalState, cursor: "C1", generatedAt: canonicalState.generatedAt }) },
    capabilities: () => live ? availableRuntimeCapabilities : unavailableCapabilities,
    subscribeCapabilityChanges(listener) {
      capabilityListener = listener;
      return () => { capabilityListener = undefined; };
    },
    publish: runtime => published.push(runtime),
  });

  await supervisor.hydrateOnce();
  assert.equal(supervisor.snapshot().capabilities.wakeEngine.available, false);
  assert.equal(typeof capabilityListener, "function");

  live = true;
  capabilityListener();
  const refreshed = supervisor.snapshot();

  assert.equal(refreshed.projection.syncState, "live");
  assert.equal(refreshed.projection.cursor, "C1");
  assert.deepEqual(refreshed.projection.state.rooms, canonicalState.rooms);
  assert.equal(refreshed.capabilities.secureTunnel.available, true);
  assert.equal(refreshed.capabilities.fullMcp.available, true);
  assert.equal(refreshed.capabilities.wakeEngine.available, true);
  assert.equal(published.at(-1).capabilities.wakeEngine.available, true);

  await supervisor.stop();
  assert.equal(capabilityListener, undefined);
});

test("failed refresh after a good snapshot marks projection stale without erasing shared data", async () => {
  let fail = false;
  const supervisor = new CouncilConnectionSupervisor({
    client: { getSnapshot: async () => {
      if (fail) throw new Error("Bearer secret-should-never-cross-renderer");
      return { schemaVersion: 1, state: canonicalState, cursor: "C1", generatedAt: canonicalState.generatedAt };
    } },
    capabilities: () => unavailableCapabilities,
  });

  await supervisor.hydrateOnce();
  fail = true;
  await supervisor.hydrateOnce();
  const runtime = supervisor.snapshot();

  assert.equal(runtime.projection.syncState, "stale");
  assert.equal(runtime.projection.state.rooms.length, 2);
  assert.equal(runtime.projection.reason.code, "SNAPSHOT_FAILED");
  assert.doesNotMatch(JSON.stringify(runtime), /secret-should-never-cross-renderer/);
});

test("failed first hydrate is sync error/unknown, never authoritative empty", async () => {
  const supervisor = new CouncilConnectionSupervisor({
    client: { getSnapshot: async () => { throw new Error("offline"); } },
    capabilities: () => unavailableCapabilities,
  });

  await supervisor.hydrateOnce();
  const runtime = supervisor.snapshot();

  assert.equal(runtime.projection.syncState, "error");
  assert.equal(Object.hasOwn(runtime.projection, "state"), false);
  assert.equal(runtime.projection.reason.code, "SNAPSHOT_FAILED");
});
