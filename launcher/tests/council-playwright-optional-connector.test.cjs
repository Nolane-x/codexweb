const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const driver = fs.readFileSync(path.join(root, 'src', 'council', 'playwright-council-driver.ts'), 'utf8');

test('managed Playwright turns prefer but do not require the ChatGPT MCP connector', () => {
  assert.match(driver, /trySelectCouncilConnector/);
  assert.match(driver, /connectorSelected/);
  assert.match(driver, /if \(connectorSelected && !await councilConnectorIsSelected\(composer\)\)/);
  assert.doesNotMatch(driver, /connector menu did not expose .* after .* attempt/);
});

test('optional connector discovery restores a clean composer before browser-only prompt insertion', () => {
  assert.match(driver, /await composer\.fill\(""\);[\s\S]*return \{ composer, connectorSelected: false \};/);
  const submitBoundary = driver.indexOf('phase(onPhase, "submit-started")');
  const pressEnter = driver.indexOf('await send.press("Enter")');
  assert.ok(submitBoundary >= 0 && pressEnter > submitBoundary, 'submit-started must remain before Enter');
});
