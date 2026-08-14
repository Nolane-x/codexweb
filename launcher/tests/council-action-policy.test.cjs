const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateCouncilAction } = require("../electron/council-action-policy.cjs");

function runtime(overrides = {}) {
  return {
    controlPlane: { state: "connected" },
    projection: { syncState: "live", state: {}, cursor: "C1", lastSyncedAt: "2026-08-14T12:00:00.000Z" },
    managedProject: { state: "unattached" },
    capabilities: {
      secureTunnel: { available: false },
      localRepo: { available: false },
      githubConnector: { available: false },
      fullMcp: { available: false },
      wakeEngine: { available: false },
    },
    ...overrides,
  };
}

test("reading synchronized Council state does not depend on local execution capabilities", () => {
  const result = evaluateCouncilAction("readCouncil", runtime());
  assert.equal(result.enabled, true);
  assert.deepEqual(result.missingRequirements, []);
});

test("an action is disabled only by its declared capability and project requirements", () => {
  const state = runtime({
    managedProject: { state: "attached", projectId: "project-1" },
    capabilities: {
      secureTunnel: { available: false },
      localRepo: { available: true },
      githubConnector: { available: true },
      fullMcp: { available: false },
      wakeEngine: { available: false },
    },
  });
  const push = evaluateCouncilAction("pushBranch", state);
  assert.equal(push.enabled, true);

  const wake = evaluateCouncilAction("wakeAgent", state);
  assert.equal(wake.enabled, false);
  assert.deepEqual(wake.missingRequirements, ["capability:wakeEngine"]);
  assert.ok(wake.reasonCodes.includes("CAPABILITY_UNAVAILABLE"));
});

test("live-projection requirement is independent from managed project attachment", () => {
  const stale = runtime({ projection: { syncState: "stale", state: {}, cursor: "C1", lastSyncedAt: "2026-08-14T12:00:00.000Z", reason: { code: "STREAM_INTERRUPTED" } } });
  const attach = evaluateCouncilAction("attachManagedProject", stale);
  assert.equal(attach.enabled, false);
  assert.deepEqual(attach.missingRequirements, ["projection:live"]);
});
