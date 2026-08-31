const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const server = read('src/council/mcp-server.ts');
const discussion = read('src/council/mcp-tools-discussion.ts');
const work = read('src/council/mcp-tools-work.ts');
const autonomy = read('src/council/mcp-tools-autonomy.ts');
const memory = read('src/council/mcp-tools-memory.ts');

const tools = [
  'council_agent_list', 'council_room_list',
  'council_task_list', 'council_task_read', 'council_decision_list', 'council_decision_read', 'council_wake_list',
  'council_agent_health', 'council_exceptional_work', 'council_memory_stats',
];

test('Council MCP read model publishes focused discovery and diagnostics tools', () => {
  for (const tool of tools) assert.match(server, new RegExp(`"${tool}"`));
});

test('focused read-model tools are authenticated and read-only', () => {
  for (const tool of ['council_agent_list', 'council_room_list']) assert.match(discussion, new RegExp(`registerTool\\("${tool}"`));
  for (const tool of ['council_task_list', 'council_task_read', 'council_decision_list', 'council_decision_read', 'council_wake_list']) assert.match(work, new RegExp(`registerTool\\("${tool}"`));
  for (const tool of ['council_agent_health', 'council_exceptional_work']) assert.match(autonomy, new RegExp(`registerTool\\("${tool}"`));
  assert.match(memory, /registerTool\("council_memory_stats"/);
  const combined = discussion + work + autonomy + memory;
  assert.ok((combined.match(/readOnlyHint: true/g) || []).length >= 10);
  assert.match(combined, /resolveActor/);
});
