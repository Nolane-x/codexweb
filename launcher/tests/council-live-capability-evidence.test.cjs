const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const main = readFileSync(join(__dirname, "..", "electron", "main-council.cjs"), "utf8");

test("Council capability readiness is driven by live runtime lifecycle evidence", () => {
  assert.match(main, /let\s+councilRuntimeLive\s*=\s*false/);
  assert.match(main, /runtimeLive:\s*councilRuntimeLive/);
  assert.match(main, /councilRuntimeLive\s*=\s*runtime\.status\s*===\s*["']ready["']/);
  assert.match(main, /operation\.status\s*===\s*["']completed["'][\s\S]{0,160}councilRuntimeLive\s*=\s*true/);
  assert.match(main, /operation\.status\s*===\s*["']running["'][\s\S]{0,220}councilRuntimeLive\s*=\s*false/);
  assert.doesNotMatch(main, /deriveCouncilCapabilities\(\{\s*configured,\s*runtimeLive:\s*false\s*\}\)/);
});
