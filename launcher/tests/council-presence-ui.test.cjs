const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const types = readFileSync(join(root, "src", "types.ts"), "utf8");
const dock = readFileSync(join(root, "src", "CouncilDock.tsx"), "utf8");
const agentsPanel = readFileSync(join(root, "src", "CouncilAgentsPanel.tsx"), "utf8");
const councilCss = readFileSync(join(root, "src", "council.css"), "utf8");
const agentsCss = readFileSync(join(root, "src", "council-agents.css"), "utf8");

test("shared projection types keep presence freshness separate from explicit agent status", () => {
  assert.match(types, /CouncilAgentPresenceView/);
  assert.match(types, /freshness:\s*"unknown"/);
  assert.match(types, /freshness:\s*"fresh"\s*\|\s*"stale"/);
  assert.match(types, /leaseExpiresAt:\s*string/);
  assert.match(types, /presence:\s*CouncilAgentPresenceView\[\]/);
});

test("Council participant online dot is driven by effective lease freshness, not explicit agent status", () => {
  assert.match(dock, /effectivePresenceFreshness/);
  assert.match(dock, /Date\.parse\(presence\.leaseExpiresAt\)/);
  assert.match(dock, /presenceClockMs/);
  assert.match(dock, /setInterval/);
  assert.match(dock, /presence-\$\{presenceFreshness\}/);
  assert.match(dock, /agent\.status/); // Explicit status remains visible as an independent dimension.
  assert.doesNotMatch(dock, /<i className=\{agent\.status\}/);
  assert.match(councilCss, /\.council-mini-avatar i\.presence-fresh/);
  assert.match(councilCss, /\.council-mini-avatar i\.presence-stale/);
  assert.match(councilCss, /\.council-mini-avatar i\.presence-unknown/);
});

test("managed Agents panel separates Council presence from Playwright execution runtime", () => {
  assert.match(agentsPanel, /projection\.state\.presence/);
  assert.match(agentsPanel, /effectivePresenceFreshness/);
  assert.match(agentsPanel, /presence-\$\{presenceFreshness\}/);
  assert.match(agentsPanel, /runtimeStatus/); // Runtime state is still rendered, but is no longer the presence dot.
  assert.doesNotMatch(agentsPanel, /<i className=\{agent\.runtimeStatus\}/);
  assert.match(agentsCss, /\.council-agent-row-avatar i\.presence-fresh/);
  assert.match(agentsCss, /\.council-agent-row-avatar i\.presence-stale/);
  assert.match(agentsCss, /\.council-agent-row-avatar i\.presence-unknown/);
});
