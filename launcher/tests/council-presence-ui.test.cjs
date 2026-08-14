const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const types = readFileSync(join(root, "src", "types.ts"), "utf8");
const dock = readFileSync(join(root, "src", "CouncilDock.tsx"), "utf8");

test("shared projection types keep presence freshness separate from explicit agent status", () => {
  assert.match(types, /CouncilAgentPresenceView/);
  assert.match(types, /freshness:\s*"unknown"/);
  assert.match(types, /freshness:\s*"fresh"\s*\|\s*"stale"/);
  assert.match(types, /leaseExpiresAt:\s*string/);
  assert.match(types, /presence:\s*CouncilAgentPresenceView\[\]/);
});

test("Council participants render explicit status and lease freshness independently", () => {
  assert.match(dock, /presenceByAgent/);
  assert.match(dock, /agent\.status/);
  assert.match(dock, /presenceFreshness/);
  assert.match(dock, /leaseExpiresAt/);
  assert.doesNotMatch(dock, /agent\.status\s*=\s*["']offline["']/);
});
