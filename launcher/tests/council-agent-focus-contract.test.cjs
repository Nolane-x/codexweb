const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');

function source(relative) {
  return fs.readFileSync(path.join(repo, relative), 'utf8');
}

test('managed runtime exposes trusted agent-only persistent conversation focus', () => {
  const runtime = source('src/council/managed-runtime.ts');
  assert.match(runtime, /async focusAgentConversation\(agentId: string\)/);
  assert.match(runtime, /agent\.conversationUrl/);
  assert.match(runtime, /transport\.focusConversation\(\{\s*agentId: agent\.id,\s*conversationUrl: agent\.conversationUrl/s);
});


test('owner/core focus bridge accepts agent identity only', () => {
  const http = source('src/council/http-server.ts');
  const main = source('src/council/mcp-main.ts');
  const electron = source('launcher/electron/main-council.cjs');
  const preload = source('launcher/electron/preload.cjs');
  assert.match(http, /\/api\/owner\/agent\/focus/);
  assert.match(http, /focusAgent\(ownerId\(body, "agent_id"\)\)/);
  assert.match(main, /focusAgent:\s*async \(agentId: string\) => \{\s*await managedRuntime!\.focusAgentConversation\(agentId\);\s*return \{ agentId, focused: true \};\s*\}/s);
  assert.doesNotMatch(main, /focusAgent:\s*\(agentId: string\) => managedRuntime!\.focusAgentConversation\(agentId\)/);
  assert.match(electron, /launcher:council-agent-focus/);
  assert.match(preload, /focusCouncilAgent/);
  const types = source('launcher/src/types.ts');
  assert.match(types, /focusCouncilAgent\(agentId: string\): Promise<\{ agentId: string; focused: true \}>/);
});
