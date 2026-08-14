const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveCouncilCapabilities } = require("../electron/council-capabilities.cjs");

test("persisted setup flags never imply live execution capability", () => {
  const capabilities = deriveCouncilCapabilities({ configured: true, runtimeLive: false });
  assert.equal(capabilities.secureTunnel.available, false);
  assert.notEqual(capabilities.secureTunnel.state, "ready");
  assert.equal(capabilities.fullMcp.available, false);
  assert.equal(capabilities.wakeEngine.available, false);
});

test("execution capability becomes ready only from explicit live evidence", () => {
  const capabilities = deriveCouncilCapabilities({ configured: true, runtimeLive: true });
  assert.equal(capabilities.secureTunnel.available, true);
  assert.equal(capabilities.secureTunnel.state, "ready");
  assert.equal(capabilities.fullMcp.available, true);
  assert.equal(capabilities.wakeEngine.available, true);
  assert.equal(capabilities.localRepo.available, false);
  assert.equal(capabilities.githubConnector.available, false);
});
