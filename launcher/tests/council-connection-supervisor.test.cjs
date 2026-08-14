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

test("live canonical projection stays visible when every local execution capability is unavailable", async () => {
  const supervisor = new CouncilConnectionSupervisor({
    client: { getSnapshot: async () => ({ schemaVersion: 1, state: canonicalState, cursor: "C1", generatedAt: canonicalState.generatedAt }) },
    capabilities: () => unavailableCapabilities,
  });

  await supervisor.hydrateOnce();
  const runtime = supervisor.snapshot();

  assert.equal(runtime.controlPlane.state, "connected");
  assert.equal(runtime.projection.syncState, "live");
  assert.equal(runtime.projection.state.rooms.length, 2);
  assert.equal(runtime.projection.state.agents.length, 2);
  assert.equal(runtime.projection.state.messages.length, 1);
  assert.equal(runtime.managedProject.state, "unattached");
  assert.equal(runtime.capabilities.localRepo.available, false);
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
