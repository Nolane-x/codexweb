const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/council/playwright-council-driver.ts'), 'utf8');

test('managed Playwright response loop is driven by the Council deep-state engine', () => {
  assert.match(source, /deriveCouncilChatGptState/);
  assert.match(source, /CouncilChatGptStateResult/);
  assert.match(source, /previousState/);
  assert.match(source, /DEEP_THINKING/);
  assert.match(source, /DOM_DRIFT/);
  assert.match(source, /WAITING_USER/);
  assert.match(source, /RATE_LIMITED/);
});

test('deep-state integration keeps post-submit failures fail-closed', () => {
  assert.match(source, /submit-started/);
  assert.match(source, /throw new Error\(`ChatGPT Council DOM_DRIFT:/);
  assert.match(source, /throw new Error\(`ChatGPT Council RATE_LIMITED:/);
  assert.match(source, /throw new Error\(`ChatGPT Council CONVERSATION_LIMIT:/);
  assert.match(source, /throw new Error\(`ChatGPT Council CONNECTION_LOST:/);
});
