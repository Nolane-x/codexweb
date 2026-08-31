const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..');
const source = relative => fs.readFileSync(path.join(repo, relative), 'utf8');

test('Mission Control keeps setup, lead binding, supervisor and diagnostics as first-class actions', () => {
  const app = source('launcher/src/CouncilApp.tsx');
  assert.match(app, /bindCurrentChatGptAsLead/);
  assert.match(app, /setupMcp/);
  assert.match(app, /setCouncilSupervisorManager/);
  assert.match(app, /runCouncilSupervisorNow/);
  assert.match(app, /openLogs/);
  assert.match(app, /Connect secure tunnel/i);
  assert.match(app, /Bind current ChatGPT as Lead/i);
  assert.match(app, /Project Manager/i);
});

test('Mission Control no longer requires legacy overlay panels to reach those actions', () => {
  const main = source('launcher/src/main.tsx');
  assert.doesNotMatch(main, /CouncilSetupPanel/);
  assert.doesNotMatch(main, /CouncilSupervisorPanel/);
  assert.doesNotMatch(main, /CouncilAgentsPanel/);
  assert.doesNotMatch(main, /CouncilDock/);
});
