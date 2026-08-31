const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const server = fs.readFileSync(path.join(root, 'src/council/mcp-server.ts'), 'utf8');
let systemTools = '';
try { systemTools = fs.readFileSync(path.join(root, 'src/council/mcp-tools-system.ts'), 'utf8'); } catch {}

test('Council MCP publishes a self-describing v2 control plane', () => {
  for (const tool of ['council_capabilities', 'council_system_status', 'council_diagnose']) assert.match(server, new RegExp(`"${tool}"`));
  assert.match(server, /registerCouncilSystemTools/);
});

test('control-plane tools stay authenticated and read-only', () => {
  for (const tool of ['council_capabilities', 'council_system_status', 'council_diagnose']) assert.match(systemTools, new RegExp(`registerTool\\("${tool}"`));
  assert.match(systemTools, /resolveActor/);
  assert.doesNotMatch(systemTools, /conversationUrl|agent_token.*return|checkpoint:/);
  const readOnlyCount = (systemTools.match(/readOnlyHint: true/g) || []).length;
  assert.ok(readOnlyCount >= 3);
});
