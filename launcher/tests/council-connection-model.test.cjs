const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

test('Mission Control owns a layered connection model instead of one online boolean', () => {
  const model = fs.readFileSync(path.join(root, 'src', 'councilConnectionModel.ts'), 'utf8');
  assert.match(model, /id: "tunnel" \| "runtime" \| "mcp" \| "connector" \| "playwright" \| "chatgpt"/);
  assert.match(model, /capabilityNode\(\s*"tunnel"/);
  assert.match(model, /capabilityNode\(\s*"mcp"/);
  assert.match(model, /id: "runtime"/);
  assert.match(model, /id: "connector"/);
  assert.match(model, /id: "playwright"/);
  assert.match(model, /id: "chatgpt"/);
  assert.match(model, /return \[tunnel, runtimeNode, mcp, connector, playwright, chatgpt\]/);
  assert.match(model, /"unverified"/);
  assert.match(model, /connectorObservation/);
  assert.match(model, /repair: string/);
  for (const action of ['Reconnect the secure tunnel','Run runtime doctor','Refresh connector catalog','Open the ChatGPT browser','Sign in to ChatGPT']) assert.match(model, new RegExp(action));
  assert.doesNotMatch(model, /connector.*mcpSetupComplete.*healthy/s);
});
