const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { deriveCouncilCapabilities } = require("../electron/council-capabilities.cjs");
const { isCouncilRuntimeLive, setCouncilRuntimeLive } = require("../electron/council-runtime-evidence.cjs");

const supervisorSource = readFileSync(join(__dirname, "..", "electron", "runtime-supervisor.cjs"), "utf8");

test("Council capability readiness follows live runtime evidence rather than persisted setup history", () => {
  setCouncilRuntimeLive(false);
  assert.equal(isCouncilRuntimeLive(), false);
  assert.equal(deriveCouncilCapabilities({ configured: true, runtimeLive: false }).wakeEngine.available, false);

  setCouncilRuntimeLive(true);
  assert.equal(isCouncilRuntimeLive(), true);
  assert.equal(deriveCouncilCapabilities({ configured: true, runtimeLive: false }).secureTunnel.available, true);
  assert.equal(deriveCouncilCapabilities({ configured: true, runtimeLive: false }).fullMcp.available, true);
  assert.equal(deriveCouncilCapabilities({ configured: true, runtimeLive: false }).wakeEngine.available, true);

  setCouncilRuntimeLive(false);
});

test("Council RuntimeSupervisor owns runtime evidence across start, recovery and shutdown", () => {
  assert.match(supervisorSource, /setCouncilRuntimeLive\(false\)[\s\S]{0,260}runtime-start/);
  assert.match(supervisorSource, /writeState\(["']ready["']\)[\s\S]{0,180}setCouncilRuntimeLive\(true\)/);
  assert.match(supervisorSource, /runtime-recovery[\s\S]{0,220}setCouncilRuntimeLive\(false\)/);
  assert.match(supervisorSource, /Council tunnel recovered[\s\S]{0,180}setCouncilRuntimeLive\(true\)/);
  assert.match(supervisorSource, /async shutdown\(\)[\s\S]{0,220}setCouncilRuntimeLive\(false\)/);
});
